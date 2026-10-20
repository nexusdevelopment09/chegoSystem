"use server";

import { randomInt } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { homeFor } from "@/lib/auth/home";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { auditFailedLogin, createSession, destroySession, getCurrentProfile, type UserRole } from "@/lib/auth/session";
import { isDatabaseOffline, sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { toE164 } from "@/lib/format";
import { acceptPendingLegalDocuments } from "@/lib/legal";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";

// ---------------------------------------------------------- telefone + senha

export type PhoneSignInState = { error?: string; phone?: string };

/**
 * A entrada de clientes, lojistas e entregadores: telefone e senha. (Enquanto o SMS é
 * simulado, um código por SMS deixaria qualquer um entrar sabendo só o telefone.)
 */
export async function signInWithPhone(_previous: PhoneSignInState, formData: FormData): Promise<PhoneSignInState> {
  const typed = String(formData.get("phone") ?? "").slice(0, 30);
  const password = String(formData.get("password") ?? "");

  // Atalho só do ambiente de testes: telefone 0000 e senha 0000 entram na conta de
  // demonstração da área de onde veio o login (cliente, lojista ou entregador).
  if (isLocalEnv && typed.replace(/\D/g, "") === "0000" && password === "0000") {
    const demo = await demoAccountFor(formData.get("area"));
    if (!demo) return { error: "Conta de demonstração não encontrada. Rode npm run db:reset.", phone: typed };
    await createSession(demo.id, "atalho_teste");
    redirect(homeFor(demo.role));
  }

  const phone = toE164(typed);
  if (!phone) return { error: "Oxe, esse telefone não parece certo. Use DDD + número.", phone: typed };
  if (!password || password.length > 72) return { error: "Digite a sua senha.", phone: typed };

  const allowed =
    (await rateLimit(`login-phone:${phone}`, 10, 600)) &&
    (await rateLimit(`login-phone:ip:${await clientIp()}`, 30, 600));
  if (!allowed) return { error: TOO_MANY_ATTEMPTS, phone: typed };

  let profile: (LoginRow & { full_name: string }) | undefined;
  try {
    [profile] = await sql<(LoginRow & { full_name: string })[]>`
      select id, role, password_hash, blocked_at, deleted_at, full_name
      from profiles where phone = ${phone} and deleted_at is null`;
  } catch (error) {
    console.error("[login] database error", error);
    return { error: databaseErrorMessage(error), phone: typed };
  }
  if (!profile || !verifyPassword(password, profile.password_hash)) {
    if (profile) await auditFailedLogin(profile.id);
    return { error: "Telefone ou senha incorretos.", phone: typed };
  }

  // Cliente bloqueado continua entrando e navegando; só não fecha pedidos.
  await createSession(profile.id);
  redirect(profile.full_name ? homeFor(profile.role) : "/cadastro");
}

/** Contas do seed usadas pelo atalho 0000/0000, uma por área de entrada. */
const DEMO_ACCOUNTS = {
  customer: "Ana Clara Souza",
  store: "Marcos Antônio Tavares", // dono da Pizzaria Forno de Barro
  courier: "Wesley Santana", // entregador do Chegô
} as const;

async function demoAccountFor(area: FormDataEntryValue | null): Promise<{ id: string; role: UserRole } | null> {
  const key = area === "store" || area === "courier" ? area : "customer";
  const [row] = await sql<{ id: string; role: UserRole }[]>`
    select id, role from profiles where full_name = ${DEMO_ACCOUNTS[key]} and deleted_at is null limit 1`;
  return row ?? null;
}

export type CreateAccountState = { error?: string; fullName?: string; phone?: string };

/** "Criar minha conta" do cliente: nome, telefone, senha e o aceite dos termos. */
export async function createCustomerAccount(_previous: CreateAccountState, formData: FormData): Promise<CreateAccountState> {
  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 80);
  const typed = String(formData.get("phone") ?? "").slice(0, 30);
  const keep = { fullName, phone: typed };

  if (fullName.length < 3) return { ...keep, error: "Diga seu nome completo." };
  const phone = toE164(typed);
  if (!phone) return { ...keep, error: "Oxe, esse telefone não parece certo. Use DDD + número." };
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { ...keep, error: problem };
  if (formData.get("accepted") !== "on") return { ...keep, error: "Para continuar, aceite os termos." };

  if (!(await rateLimit(`signup:ip:${await clientIp()}`, 10, 3600))) return { ...keep, error: TOO_MANY_ATTEMPTS };

  const [taken] = await sql`select 1 from profiles where phone = ${phone} and deleted_at is null`;
  if (taken) return { ...keep, error: "Esse telefone já tem conta no Chegô. Entre com a sua senha." };

  let created: { id: string } | undefined;
  try {
    [created] = await sql<{ id: string }[]>`
      insert into profiles (phone, full_name, role, password_hash, referral_code)
      values (${phone}, ${fullName}, 'customer', ${hashPassword(password)}, ${`CHEGO${randomInt(100000, 999999)}`})
      returning id`;
  } catch (error) {
    // Duas contas com o mesmo telefone ao mesmo tempo: a segunda perde a corrida.
    if ((error as { code?: string }).code === "23505") return { ...keep, error: "Esse telefone já tem conta no Chegô. Entre com a sua senha." };
    throw error;
  }
  await acceptPendingLegalDocuments(created.id, "customer");
  await createSession(created.id, "cadastro");
  redirect("/");
}

function databaseErrorMessage(error: unknown): string {
  return isLocalEnv && isDatabaseOffline(error)
    ? "Banco de dados local desligado. Rode npm run db:start."
    : "Eita, deu um problema aqui. Tenta de novo daqui a pouco.";
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
      error: databaseErrorMessage(error),
    };
  }

  if (!profile || !verifyPassword(parsed.data.password, profile.password_hash)) {
    if (profile) await auditFailedLogin(profile.id);
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
