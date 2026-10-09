import "server-only";
import { headers } from "next/headers";
import { sql } from "@/lib/db";

/**
 * Counts one attempt and tells whether it is still allowed.
 * Fixed window kept in the database, so no extra service is needed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (key, window_start)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}))
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;

  // Old windows are useless; clean up now and then.
  if (Math.random() < 0.02) {
    await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  }
  return row.count <= limit;
}

/** Best guess of the visitor's address, for per-IP limits. */
export async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export const TOO_MANY_ATTEMPTS = "Eita, muitas tentativas. Espera uns minutinhos e tenta de novo.";
