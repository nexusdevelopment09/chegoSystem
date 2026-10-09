import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "@/lib/db";
import { pendingLegalDocuments } from "@/lib/legal";

export type UserRole = "customer" | "merchant" | "admin";
export type StoreRole = "owner" | "attendant" | "courier";

export type CurrentProfile = {
  id: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  /** Blocked users can sign in and look around, but cannot place orders. */
  blocked: boolean;
  birthDate: string | null;
  cityId: string | null;
};

const COOKIE = "chego_session";
const SESSION_DAYS = 30;

// Only the hash goes to the database, so a leaked table cannot be used to log in.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(profileId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    insert into sessions (profile_id, token_hash, expires_at)
    values (${profileId}, ${hashToken(token)}, ${expiresAt})
  `;

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
  if (token) await sql`delete from sessions where token_hash = ${hashToken(token)}`;
  cookieStore.delete(COOKIE);
}

/** "Sair de todos os aparelhos". */
export async function destroyAllSessions(profileId: string) {
  await sql`delete from sessions where profile_id = ${profileId}`;
  (await cookies()).delete(COOKIE);
}

/** Signed-in user's profile, read from the database (never from the browser). */
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
 * Signed-in user with the sign-up finished: has a name and has accepted the
 * current version of the terms. Otherwise sends them to the missing step.
 */
export async function requireUser(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (!profile.fullName) redirect("/cadastro");
  if ((await pendingLegalDocuments(profile.id, profile.role)).length > 0) redirect("/termos/aceitar");
  return profile;
}

/** Redirects away unless the user has one of the given global roles. */
export async function requireRole(...roles: UserRole[]): Promise<CurrentProfile> {
  const profile = await requireUser();
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

export type StoreMembership = { storeId: string; storeName: string; storeSlug: string; role: StoreRole };

export const getStoreMemberships = cache(async (profileId: string): Promise<StoreMembership[]> => {
  const rows = await sql<{ store_id: string; name: string; slug: string; role: StoreRole }[]>`
    select m.store_id, s.name, s.slug, m.role
    from store_members m
    join stores s on s.id = m.store_id
    where m.profile_id = ${profileId}
    order by s.name`;
  return rows.map((row) => ({ storeId: row.store_id, storeName: row.name, storeSlug: row.slug, role: row.role }));
});

/**
 * The user's membership in a store, limited to the given store roles.
 * Without `storeId` the first store the user works for is used.
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
