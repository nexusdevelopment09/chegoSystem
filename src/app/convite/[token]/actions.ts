"use server";

import { randomInt } from "node:crypto";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { acceptPendingLegalDocuments } from "@/lib/legal";
import { createSession, getCurrentProfile } from "@/lib/auth/session";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { toE164 } from "@/lib/format";
import { hashInvite } from "@/lib/merchant/invites";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";

export type AcceptState = { error?: string };

type Invite = { id: string; store_id: string; full_name: string; phone: string | null; role: "attendant" | "courier"; permissions: string[] | null };

/**
 * Aceita o convite: uma vez só (o convite é travado e marcado como usado na mesma
 * transação), dentro do prazo e, se o convite tem telefone, só para esse telefone.
 */
export async function acceptInvite(_previous: AcceptState, formData: FormData): Promise<AcceptState> {
  if (!(await rateLimit(`invite:ip:${await clientIp()}`, 20, 3600))) return { error: TOO_MANY_ATTEMPTS };
  const token = String(formData.get("token") ?? "");
  const current = await getCurrentProfile();

  let newAccount: { name: string; phone: string; password: string } | null = null;
  if (!current) {
    const name = String(formData.get("fullName") ?? "").trim().slice(0, 80);
    const phone = toE164(String(formData.get("phone") ?? ""));
    const password = String(formData.get("password") ?? "");
    if (name.length < 3) return { error: "Diga seu nome completo." };
    if (!phone) return { error: "Telefone inválido. Use DDD + número." };
    const problem = passwordProblem(password);
    if (problem) return { error: problem };
    const [taken] = await sql`select 1 from profiles where phone = ${phone} and deleted_at is null`;
    if (taken) return { error: "Esse telefone já tem conta no Chegô. Entre com a sua senha e abra o link do convite de novo." };
    newAccount = { name, phone, password };
  }

  const at = await now();
  const result = await sql.begin(async (tx): Promise<{ error: string } | { profileId: string; storeId: string; role: string }> => {
    const [invite] = await tx<Invite[]>`
      select id, store_id, full_name, phone, role, permissions from store_invites
      where token_hash = ${hashInvite(token)} and used_at is null and revoked_at is null and expires_at > ${at}
      for update`;
    if (!invite) return { error: "Este convite não vale mais: já foi usado, foi cancelado ou venceu. Peça outro à loja." };
    const phone = current?.phone ?? newAccount!.phone;
    if (invite.phone && invite.phone !== phone) return { error: "Este convite é para outro telefone." };

    let profileId = current?.id;
    if (!profileId) {
      const [created] = await tx<{ id: string }[]>`
        insert into profiles (phone, full_name, role, password_hash, referral_code)
        values (${newAccount!.phone}, ${newAccount!.name}, 'merchant', ${hashPassword(newAccount!.password)}, ${`CHEGO${randomInt(100000, 999999)}`})
        returning id`;
      profileId = created.id;
    } else {
      await tx`update profiles set role = 'merchant' where id = ${profileId} and role = 'customer'`;
    }
    const [owner] = await tx`select 1 from store_members where store_id = ${invite.store_id} and profile_id = ${profileId} and role = 'owner'`;
    if (owner) return { error: "Você já é o dono desta loja." };
    await tx`
      insert into store_members (store_id, profile_id, role, permissions, active, invited_by)
      values (${invite.store_id}, ${profileId}, ${invite.role}, ${invite.permissions}, true, (select created_by from store_invites where id = ${invite.id}))
      on conflict (store_id, profile_id) do update set role = excluded.role, permissions = excluded.permissions, active = true, deactivated_at = null`;
    await tx`update store_invites set used_at = ${at}, used_by = ${profileId} where id = ${invite.id}`;
    await audit({ actorId: profileId, actorRole: invite.role, action: "equipe.convite_aceito", module: invite.role === "courier" ? "entregadores" : "equipe", entityType: "store_invite", entityId: invite.id, storeId: invite.store_id }, tx);
    return { profileId, storeId: invite.store_id, role: invite.role };
  });
  if ("error" in result) return result;
  if (!current) {
    await acceptPendingLegalDocuments(result.profileId, "merchant");
    await createSession(result.profileId, "convite");
  }
  redirect(result.role === "courier" ? "/lojista/entregas" : "/lojista");
}
