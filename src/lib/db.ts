import "server-only";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";

// One pool for the whole server. Kept on globalThis so the dev server's hot
// reload does not open a new pool on every file change.
const globalForDb = globalThis as unknown as { chegoSql?: postgres.Sql };

export const sql =
  globalForDb.chegoSql ??
  postgres(databaseUrl(), { max: 10, connect_timeout: 5, onnotice: () => {} });

if (process.env.NODE_ENV !== "production") globalForDb.chegoSql = sql;

/** True when the error means the database could not be reached at all. */
export function isDatabaseOffline(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ECONNREFUSED" || code === "CONNECT_TIMEOUT" || code === "ECONNRESET";
}
