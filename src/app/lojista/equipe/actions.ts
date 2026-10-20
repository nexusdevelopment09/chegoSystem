"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission, requireStoreMember } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { toE164 } from "@/lib/format";
import { hashInvite } from "@/lib/merchant/invites";
import { checkGrant, DEFAULTS, effectivePermissions, type MemberRole } from "@/lib/merchant/permissions";
import { now } from "@/lib/clock";

// Funcionários e entregadores da loja. Toda ação confere a permissão no servidor; ninguém
// mexe no dono nem nas próprias permissões; ninguém dá uma permissão que não tem. Desativar
// nunca apaga: o histórico (pedidos, movimentações, auditoria) fica.

export type ActionState = { error?: string; ok?: boolean; message?: string; link?: string };

const uuid = z.uuid();
const INVITE_DAYS = 7;
const done = () => revalidatePath("/lojista", "layout");

async function targetMember(storeId: string, profileId: string) {
  const [row] = await sql<{ role: MemberRole; permissions: string[] | null; active: boolean; full_name: string }[]>`
    select m.role, m.permissions, m.active, p.full_name from store_members m join profiles p on p.id = m.profile_id
    where m.store_id = ${storeId} and m.profile_id = ${profileId}`;
  return row ?? null;
}

/** Convite de uso único, válido por 7 dias. O link só aparece agora, para o dono repassar. */
export async function createInvite(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const role = z.enum(["attendant", "courier"]).safeParse(formData.get("role"));
  if (!role.success) return { error: "Escolha a função." };
  // Convidar entregador pede a permissão de entregadores; funcionário, a de equipe.
  const { profile, membership } = await requirePermission(role.data === "courier" ? "entregadores.gerenciar" : "equipe.gerenciar");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name.length < 2) return { error: "Diga o nome da pessoa." };
  const phoneText = String(formData.get("phone") ?? "").trim();
  const phone = phoneText ? toE164(phoneText) : null;
  if (phoneText && !phone) return { error: "Telefone inválido. Use DDD + número." };
  const custom = formData.get("customPermissions") === "on";
  let permissions: string[] | null = null;
  if (custom) {
    const check = checkGrant({ profileId: profile.id, role: membership.role, permissions: membership.permissions }, { profileId: "", role: role.data }, formData.getAll("permissions").map(String));
    if (!check.ok) return { error: check.error };
    permissions = check.permissions;
  }
  const token = randomBytes(24).toString("base64url");
  const expires = new Date((await now()).getTime() + INVITE_DAYS * 86_400_000);
  const [invite] = await sql<{ id: string }[]>`
    insert into store_invites (store_id, token_hash, full_name, phone, role, permissions, expires_at, created_by)
    values (${membership.storeId}, ${hashInvite(token)}, ${name}, ${phone}, ${role.data}, ${permissions}, ${expires}, ${profile.id})
    returning id`;
  await audit({ actorId: profile.id, actorRole: membership.role, action: "equipe.convite_criado", module: "equipe", entityType: "store_invite", entityId: invite.id, storeId: membership.storeId, details: { nome: name, funcao: role.data, permissoes: permissions ?? "padrão" } });
  done();
  return { ok: true, message: `Convite criado para ${name}. Mande o link abaixo (vale por ${INVITE_DAYS} dias e só pode ser usado uma vez).`, link: `/convite/${token}` };
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const id = uuid.parse(formData.get("id"));
  const [invite] = await sql<{ role: string }[]>`select role from store_invites where id = ${id}`;
  const { profile, membership } = await requirePermission(invite?.role === "courier" ? "entregadores.gerenciar" : "equipe.gerenciar");
  const rows = await sql`update store_invites set revoked_at = now() where id = ${id} and store_id = ${membership.storeId} and used_at is null and revoked_at is null returning id`;
  if (rows.length > 0) await audit({ actorId: profile.id, actorRole: membership.role, action: "equipe.convite_cancelado", module: "equipe", entityType: "store_invite", entityId: id, storeId: membership.storeId });
  done();
}

export async function updatePermissions(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("equipe.permissoes");
  const target = uuid.safeParse(formData.get("profileId"));
  if (!target.success) return { error: "Pessoa inválida." };
  const member = await targetMember(membership.storeId, target.data);
  if (!member) return { error: "Essa pessoa não é da equipe." };
  const useDefaults = formData.get("defaults") === "on";
  const wanted = useDefaults ? DEFAULTS[member.role] : formData.getAll("permissions").map(String);
  const check = checkGrant({ profileId: profile.id, role: membership.role, permissions: membership.permissions }, { profileId: target.data, role: member.role }, wanted);
  if (!check.ok) {
    await audit({ actorId: profile.id, actorRole: membership.role, action: "equipe.permissoes", module: "equipe", entityType: "profile", entityId: target.data, storeId: membership.storeId, result: "negado", details: { pedido: wanted, motivo: check.error } });
    return { error: check.error };
  }
  const before = effectivePermissions(member.role, member.permissions);
  await sql.begin(async (tx) => {
    await tx`update store_members set permissions = ${useDefaults ? null : check.permissions} where store_id = ${membership.storeId} and profile_id = ${target.data}`;
    await audit({
      actorId: profile.id, actorRole: membership.role, action: "equipe.permissoes", module: "equipe", entityType: "profile", entityId: target.data, storeId: membership.storeId,
      details: { antes: before, depois: useDefaults ? `padrão (${DEFAULTS[member.role].length})` : check.permissions },
    }, tx);
  });
  done();
  return { ok: true, message: `Permissões de ${member.full_name || "funcionário"} salvas.` };
}

export async function setMemberActive(formData: FormData): Promise<void> {
  const { membership: current } = await requireStoreMember(["owner", "attendant"]);
  const target = uuid.parse(formData.get("profileId"));
  const active = formData.get("active") === "1";
  const member = await targetMember(current.storeId, target);
  if (!member || member.role === "owner") return;
  // Gerenciar entregador pede a permissão de entregadores; funcionário, a de equipe.
  const { profile, membership } = await requirePermission(member.role === "courier" ? "entregadores.gerenciar" : "equipe.gerenciar");
  if (target === profile.id) return;
  await sql.begin(async (tx) => {
    await tx`update store_members set active = ${active}, deactivated_at = ${active ? null : await now()} where store_id = ${membership.storeId} and profile_id = ${target}`;
    // Entregador desativado não recebe mais entregas desta loja ainda não saídas.
    if (!active && member.role === "courier") {
      await tx`update orders set courier_id = null where store_id = ${membership.storeId} and courier_id = ${target} and status in ('accepted', 'preparing', 'ready')`;
    }
    await audit({ actorId: profile.id, actorRole: membership.role, action: active ? "equipe.reativado" : "equipe.desativado", module: member.role === "courier" ? "entregadores" : "equipe", entityType: "profile", entityId: target, storeId: membership.storeId, details: { nome: member.full_name, funcao: member.role } }, tx);
  });
  done();
}

/** Encerra as sessões abertas da pessoa (ela precisa entrar de novo em todos os aparelhos). */
export async function revokeMemberSessions(formData: FormData): Promise<void> {
  const { profile, membership } = await requirePermission("equipe.gerenciar");
  const target = uuid.parse(formData.get("profileId"));
  if (target === profile.id) return;
  const member = await targetMember(membership.storeId, target);
  if (!member || member.role === "owner") return;
  const removed = await sql`delete from sessions where profile_id = ${target} returning profile_id`;
  await audit({ actorId: profile.id, actorRole: membership.role, action: "equipe.sessoes_encerradas", module: "equipe", entityType: "profile", entityId: target, storeId: membership.storeId, details: { sessoes: removed.length } });
  done();
}

export async function renameMember(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("equipe.gerenciar");
  const target = uuid.safeParse(formData.get("profileId"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!target.success || name.length < 2) return { error: "Diga o nome." };
  const member = await targetMember(membership.storeId, target.data);
  if (!member || member.role === "owner") return { error: "Não é possível editar essa pessoa." };
  // Só muda o nome de quem trabalha apenas nesta loja (o perfil de outra loja ou de cliente é da própria pessoa).
  const [elsewhere] = await sql`select 1 from store_members where profile_id = ${target.data} and store_id <> ${membership.storeId}`;
  if (elsewhere) return { error: "Essa pessoa também trabalha em outra loja: o nome ela mesma altera no perfil." };
  await sql`update profiles set full_name = ${name} where id = ${target.data}`;
  await audit({ actorId: profile.id, actorRole: membership.role, action: "equipe.nome", module: "equipe", entityType: "profile", entityId: target.data, storeId: membership.storeId, details: { antes: member.full_name, depois: name } });
  done();
  return { ok: true, message: "Nome salvo." };
}
