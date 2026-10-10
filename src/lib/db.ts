import "server-only";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";

// Um pool para o servidor inteiro. Fica no globalThis para o recarregamento
// automático do servidor de desenvolvimento não abrir um pool novo a cada arquivo alterado.
const globalForDb = globalThis as unknown as { chegoSql?: postgres.Sql };

/**
 * Conexão dona do banco: passa por cima das regras de acesso por linha (RLS). Use só em
 * código de servidor que já conferiu quem é o usuário (checkout, pagamentos, mudanças
 * de status, ações do admin). Para todo o resto use `withUser`.
 */
export const sql =
  globalForDb.chegoSql ??
  postgres(databaseUrl(), { max: 10, connect_timeout: 5, onnotice: () => {} });

if (process.env.NODE_ENV !== "production") globalForDb.chegoSql = sql;

/**
 * Roda consultas como um usuário, com as regras de acesso por linha (RLS) aplicadas.
 * Passe `null` para um visitante anônimo.
 */
export function withUser<T>(
  profileId: string | null,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${profileId ?? ""}, true)`;
    await tx`set local role app_user`;
    return run(tx);
  });
}

/** Verdadeiro quando o erro significa que nem deu para alcançar o banco. */
export function isDatabaseOffline(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ECONNREFUSED" || code === "CONNECT_TIMEOUT" || code === "ECONNRESET";
}
