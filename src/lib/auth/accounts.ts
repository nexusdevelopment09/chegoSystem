import "server-only";
import type postgres from "postgres";
import { hashPassword, passwordProblem, temporaryPassword } from "./password";

type Tx = postgres.TransactionSql;
type NewAccount = { phone: string; fullName: string; role: "merchant" | "courier"; cityId?: string | null };
type Account = { id: string; role: string };

/**
 * Conta para um cadastro feito pela própria pessoa ("Quero vender", "Quero entregar").
 * Telefone novo: cria a conta com a senha escolhida. Telefone que já tem conta: só vale
 * se for de quem está conectado, para ninguém tomar a conta de outra pessoa sabendo o telefone.
 */
export async function selfSignupAccount(
  tx: Tx,
  account: NewAccount & { password: string; signedInId: string | null },
): Promise<{ account: Account; created: boolean } | { error: string }> {
  const [existing] = await tx<Account[]>`select id, role from profiles where phone = ${account.phone} and deleted_at is null`;
  if (existing) {
    if (existing.id !== account.signedInId) {
      return { error: "Esse telefone já tem conta no Chegô. Entre com ele (telefone e senha) e volte aqui para terminar o cadastro." };
    }
    return { account: existing, created: false };
  }

  const problem = passwordProblem(account.password);
  if (problem) return { error: problem };
  const [created] = await tx<Account[]>`
    insert into profiles (phone, full_name, role, city_id, password_hash)
    values (${account.phone}, ${account.fullName}, ${account.role}, ${account.cityId ?? null}, ${hashPassword(account.password)})
    returning id, role`;
  return { account: created, created: true };
}

/**
 * Conta para alguém cadastrado por outra pessoa (equipe da loja, entregador do Chegô).
 * Quem já tem conta continua com a própria senha; quem é novo ganha uma senha provisória,
 * mostrada uma única vez para ser repassada.
 */
export async function invitedAccount(tx: Tx, account: NewAccount): Promise<{ account: Account; password: string | null }> {
  const [existing] = await tx<Account[]>`select id, role from profiles where phone = ${account.phone} and deleted_at is null`;
  if (existing) return { account: existing, password: null };

  const password = temporaryPassword();
  const [created] = await tx<Account[]>`
    insert into profiles (phone, full_name, role, city_id, password_hash)
    values (${account.phone}, ${account.fullName}, ${account.role}, ${account.cityId ?? null}, ${hashPassword(password)})
    returning id, role`;
  return { account: created, password };
}

/** Frase para mostrar a senha provisória a quem fez o cadastro. */
export const temporaryPasswordNote = (password: string | null) =>
  password ? ` Senha provisória: ${password}. Passe para a pessoa; ela pode trocar em Meu perfil.` : " Ela entra com o telefone e a senha que já usa.";
