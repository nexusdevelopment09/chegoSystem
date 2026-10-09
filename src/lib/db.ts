import "server-only";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";

// One pool for the whole server. Kept on globalThis so the dev server's hot
// reload does not open a new pool on every file change.
const globalForDb = globalThis as unknown as { chegoSql?: postgres.Sql };

/**
 * Owner connection: bypasses Row Level Security. Use it only in server code
 * that has already checked who the user is (checkout, payments, status
 * changes, admin actions). For everything else use `withUser`.
 */
export const sql =
  globalForDb.chegoSql ??
  postgres(databaseUrl(), { max: 10, connect_timeout: 5, onnotice: () => {} });

if (process.env.NODE_ENV !== "production") globalForDb.chegoSql = sql;

/**
 * Runs queries as a given user, with Row Level Security applied.
 * Pass `null` for an anonymous visitor.
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

/** True when the error means the database could not be reached at all. */
export function isDatabaseOffline(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ECONNREFUSED" || code === "CONNECT_TIMEOUT" || code === "ECONNRESET";
}
