"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, type UserRole } from "@/lib/auth/session";
import { isDatabaseOffline, sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";

const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(72),
});

export type LoginState = { error?: string };

/**
 * Locally "admin" is accepted as a shortcut for "admin@chego.local"
 * (LOGIN_USERNAME_DOMAIN). Without that variable only e-mails are accepted.
 */
function toEmail(identifier: string): string | null {
  if (identifier.includes("@")) return identifier;
  const domain = process.env.LOGIN_USERNAME_DOMAIN;
  return domain ? `${identifier}@${domain}` : null;
}

type LoginRow = {
  id: string;
  role: UserRole;
  password_hash: string | null;
  blocked_at: Date | null;
  deleted_at: Date | null;
};

export async function signIn(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Preencha o usuário e a senha." };

  const email = toEmail(parsed.data.identifier);
  if (!email || !z.email().safeParse(email).success) {
    return { error: "Digite um e-mail válido." };
  }

  let profile: LoginRow | undefined;
  try {
    [profile] = await sql<LoginRow[]>`
      select id, role, password_hash, blocked_at, deleted_at
      from profiles
      where email = ${email}
    `;
  } catch (error) {
    console.error("[login] database error", error);
    return {
      error:
        isLocalEnv && isDatabaseOffline(error)
          ? "Banco de dados local desligado. Rode npm run db:start."
          : "Eita, deu um problema aqui. Tenta de novo daqui a pouco.",
    };
  }

  if (!profile || !verifyPassword(parsed.data.password, profile.password_hash)) {
    return { error: "Usuário ou senha incorretos." };
  }
  if (profile.blocked_at || profile.deleted_at) {
    return { error: "Esta conta não pode entrar. Fale com o suporte." };
  }

  await createSession(profile.id);
  redirect(profile.role === "admin" ? "/admin" : "/");
}

export async function signOut() {
  await destroySession();
  redirect("/entrar");
}
