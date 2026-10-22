import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { audit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { pendingLegalDocuments } from "@/lib/legal";
import { can, effectivePermissions, type Permission } from "@/lib/merchant/permissions";

export type UserRole = "customer" | "merchant" | "admin" | "courier";
export type StoreRole = "owner" | "attendant" | "courier";

export type CurrentProfile = {
  id: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  /** Usuários bloqueados conseguem entrar e olhar, mas não conseguem fazer pedidos. */
  blocked: boolean;
  birthDate: string | null;
  cityId: string | null;
};

const COOKIE = "chego_session";
const SESSION_DAYS = 30;

// Só o hash vai para o banco, então uma tabela vazada não serve para entrar.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(profileId: string, method = "senha") {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    insert into sessions (profile_id, token_hash, expires_at)
    values (${profileId}, ${hashToken(token)}, ${expiresAt})
  `;
  // Entrada no sistema: quem, quando e como (nunca a senha nem o token).
  await audit({ actorId: profileId, action: "auth.entrada", entityType: "profile", entityId: profileId, module: "acesso", actorRole: await roleOf(profileId), details: { method } });

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (token) {
    const [ended] = await sql<{ profile_id: string }[]>`delete from sessions where token_hash = ${hashToken(token)} returning profile_id`;
    if (ended) await audit({ actorId: ended.profile_id, action: "auth.saida", entityType: "profile", entityId: ended.profile_id, module: "acesso", actorRole: await roleOf(ended.profile_id) });
  }
  cookieStore.delete(COOKIE);
}

/** Senha errada numa conta que existe: fica no histórico da conta como tentativa negada. */
export async function auditFailedLogin(profileId: string) {
  await audit({ actorId: profileId, action: "auth.entrada", entityType: "profile", entityId: profileId, module: "acesso", result: "negado", reason: "Senha incorreta", actorRole: await roleOf(profileId) });
}

async function roleOf(profileId: string): Promise<string | null> {
  const [row] = await sql<{ role: string }[]>`select role::text from profiles where id = ${profileId}`;
  return row?.role ?? null;
}

/** "Sair de todos os aparelhos". */
export async function destroyAllSessions(profileId: string) {
  await sql`delete from sessions where profile_id = ${profileId}`;
  (await cookies()).delete(COOKIE);
}

/** Perfil de quem entrou, lido do banco (nunca do navegador). */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const [row] = await sql<{
    id: string; full_name: string; phone: string | null; role: UserRole;
    blocked_at: Date | null; birth_date: string | null; city_id: string | null;
  }[]>`
    select p.id, p.full_name, p.phone, p.role, p.blocked_at, p.birth_date::text, p.city_id
    from sessions s
    join profiles p on p.id = s.profile_id
    where s.token_hash = ${hashToken(token)}
      and s.expires_at > now()
      and p.deleted_at is null
  `;
  if (!row) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    role: row.role,
    blocked: row.blocked_at !== null,
    birthDate: row.birth_date,
    cityId: row.city_id,
  };
});

/**
 * Usuário que entrou e terminou o cadastro: tem nome e aceitou a versão
 * atual dos termos. Senão, é mandado para o passo que falta.
 */
export async function requireUser(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (!profile.fullName) redirect("/cadastro");
  if ((await pendingLegalDocuments(profile.id, profile.role)).length > 0) redirect("/termos/aceitar");
  return profile;
}

/** Redireciona para fora, a não ser que o usuário tenha um dos papéis globais informados. */
export async function requireRole(...roles: UserRole[]): Promise<CurrentProfile> {
  const profile = await requireUser();
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

/**
 * Ações globais críticas (suspender e excluir contas, anúncios, corrigir nota): só o super admin.
 * Admin comum vê o painel; a tentativa fica na auditoria e ele volta com o aviso.
 */
export async function requireSuperAdmin(): Promise<CurrentProfile> {
  const profile = await requireRole("admin");
  if (!(await isSuperAdmin(profile.id))) {
    await audit({ actorId: profile.id, action: "acesso.negado", entityType: "permission", actorRole: "admin", module: "acesso", result: "negado", details: { permission: "super_admin" } });
    redirect("/admin?negado=1");
  }
  return profile;
}

export async function isSuperAdmin(profileId: string): Promise<boolean> {
  const [row] = await sql<{ super: boolean }[]>`select is_super_admin as super from profiles where id = ${profileId} and role = 'admin' and deleted_at is null`;
  return row?.super ?? false;
}

export type StoreMembership = { storeId: string; storeName: string; storeSlug: string; role: StoreRole; permissions: Permission[] };

export const getStoreMemberships = cache(async (profileId: string): Promise<StoreMembership[]> => {
  // Membro desativado não entra mais no painel (o histórico dele continua).
  const rows = await sql<{ store_id: string; name: string; slug: string; role: StoreRole; permissions: string[] | null }[]>`
    select m.store_id, s.name, s.slug, m.role, m.permissions
    from store_members m
    join stores s on s.id = m.store_id
    where m.profile_id = ${profileId} and m.active and s.closed_at is null
    order by s.name`;
  return rows.map((row) => ({
    storeId: row.store_id, storeName: row.name, storeSlug: row.slug, role: row.role,
    permissions: effectivePermissions(row.role, row.permissions),
  }));
});

/**
 * O vínculo do usuário com uma loja, limitado aos papéis de loja informados.
 * Sem `storeId`, vale a primeira loja em que o usuário trabalha.
 */
export async function requireStoreMember(
  roles: StoreRole[],
  storeId?: string,
): Promise<{ profile: CurrentProfile; membership: StoreMembership }> {
  const profile = await requireUser();
  const memberships = await getStoreMemberships(profile.id);
  const membership = memberships.find(
    (item) => (storeId ? item.storeId === storeId : true) && roles.includes(item.role),
  );
  if (!membership) redirect(memberships.length > 0 ? "/lojista" : "/");
  return { profile, membership };
}

/**
 * O vínculo com a loja, exigindo uma permissão (o dono tem todas). Sem a permissão, a
 * tentativa fica na auditoria e a pessoa volta ao painel com o aviso de acesso negado.
 */
export async function requirePermission(permission: Permission): Promise<{ profile: CurrentProfile; membership: StoreMembership }> {
  const { profile, membership } = await requireStoreMember(["owner", "attendant", "courier"]);
  if (!can(membership, permission)) {
    await audit({
      actorId: profile.id, action: "acesso.negado", entityType: "permission", storeId: membership.storeId,
      actorRole: membership.role, module: "acesso", result: "negado", details: { permission },
    });
    // O entregador da loja só tem a tela de entregas: volta para ela em vez do aviso.
    redirect(membership.role === "courier" ? "/lojista/entregas" : "/lojista?negado=1");
  }
  return { profile, membership };
}

/** A pessoa tem esta permissão na loja? (para mostrar ou esconder botões; a ação confere de novo.) */
export const hasPermission = (membership: StoreMembership, permission: Permission) => can(membership, permission);
