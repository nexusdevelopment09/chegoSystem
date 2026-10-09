import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";

export type UserRole = "customer" | "merchant" | "admin";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: UserRole;
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

/** Signed-in user's profile, read from the database (never from the browser). */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const [profile] = await sql<{ id: string; full_name: string; role: UserRole }[]>`
    select p.id, p.full_name, p.role
    from sessions s
    join profiles p on p.id = s.profile_id
    where s.token_hash = ${hashToken(token)}
      and s.expires_at > now()
      and p.blocked_at is null
      and p.deleted_at is null
  `;
  if (!profile) return null;

  return { id: profile.id, fullName: profile.full_name, role: profile.role };
}

/** Redirects to the login page unless the user has one of the given roles. */
export async function requireRole(...roles: UserRole[]): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}
