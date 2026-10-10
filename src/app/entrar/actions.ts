"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homeFor } from "@/lib/auth/home";
import { verifyPassword } from "@/lib/auth/password";
import { requestLoginCode, verifyLoginCode } from "@/lib/auth/phone-login";
import { createSession, destroySession, getCurrentProfile, type UserRole } from "@/lib/auth/session";
import { isDatabaseOffline, sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { toE164 } from "@/lib/format";
import { acceptPendingLegalDocuments } from "@/lib/legal";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";


// -------------------------------------------------------- telefone + código

export type PhoneLoginState = { step: "phone" | "code"; phone?: string; error?: string };

/** Passo 1: recebe o telefone e envia o código. Passo 2: confere o código. */
export async function phoneLogin(previous: PhoneLoginState, formData: FormData): Promise<PhoneLoginState> {
  const intent = formData.get("intent");

  if (intent === "send") {
    const phone = toE164(String(formData.get("phone") ?? ""));
    if (!phone) return { step: "phone", error: "Oxe, esse telefone não parece certo. Use DDD + número." };

    const allowed =
      (await rateLimit(`login-code:phone:${phone}`, 5, 600)) &&
      (await rateLimit(`login-code:ip:${await clientIp()}`, 30, 600));
    if (!allowed) return { step: "phone", error: TOO_MANY_ATTEMPTS };

    await requestLoginCode(phone);
    return { step: "code", phone };
  }

  const parsed = z
    .object({ phone: z.string().regex(/^\+55\d{10,11}$/), code: z.string().trim().regex(/^\d{6}$/) })
    .safeParse({ phone: formData.get("phone"), code: formData.get("code") });
  if (!parsed.success) {
    return { step: "code", phone: previous.phone, error: "Digite os 6 números do código." };
  }
  const { phone, code } = parsed.data;

  if (!(await rateLimit(`login-verify:${phone}`, 10, 600))) {
    return { step: "code", phone, error: TOO_MANY_ATTEMPTS };
  }

  const result = await verifyLoginCode(phone, code);
  if (!result.ok) {
    return {
      step: "code",
      phone,
      error: result.reason === "invalid" ? "Código errado. Confere e tenta de novo." : "Esse código venceu. Peça um novo.",
    };
  }

  await createSession(result.profileId);
  const [profile] = await sql<{ role: UserRole; full_name: string }[]>`
    select role, full_name from profiles where id = ${result.profileId}`;
  redirect(profile.full_name ? homeFor(profile.role) : "/cadastro");
}

// ----------------------------------------------------------------- cadastro

export type SignupState = { error?: string };

const signupSchema = z.object({
  fullName: z.string().trim().min(3, "Diga seu nome completo.").max(80),
  accepted: z.literal("on", { error: "Para continuar, aceite os termos." }),
});

/** Conclui o cadastro: nome e aceite dos termos atuais. */
export async function completeSignup(_previous: SignupState, formData: FormData): Promise<SignupState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");

  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    accepted: formData.get("accepted"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await sql`update profiles set full_name = ${parsed.data.fullName} where id = ${profile.id}`;
  await acceptPendingLegalDocuments(profile.id, profile.role);
  redirect(homeFor(profile.role));
}

/** Aceita uma nova versão dos termos. */
export async function acceptTerms(_previous: SignupState, formData: FormData): Promise<SignupState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (formData.get("accepted") !== "on") return { error: "Para continuar, aceite os termos." };

  await acceptPendingLegalDocuments(profile.id, profile.role);
  redirect(homeFor(profile.role));
}

// ----------------------------------------------------------- e-mail + senha

const passwordSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(72),
});

export type LoginState = { error?: string };

/**
 * No ambiente de testes "admin" é aceito como atalho para
 * "admin@chego.local" (LOGIN_USERNAME_DOMAIN).
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

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = passwordSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Preencha o usuário e a senha." };

  const email = toEmail(parsed.data.identifier);
  if (!email || !z.email().safeParse(email).success) return { error: "Digite um e-mail válido." };

  if (!(await rateLimit(`login-password:${email}`, 10, 600))) return { error: TOO_MANY_ATTEMPTS };

  let profile: LoginRow | undefined;
  try {
    [profile] = await sql<LoginRow[]>`
      select id, role, password_hash, blocked_at, deleted_at from profiles where email = ${email}`;
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
  redirect(homeFor(profile.role));
}

export async function signOut() {
  await destroySession();
  redirect("/entrar");
}
