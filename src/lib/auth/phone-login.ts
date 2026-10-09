import "server-only";
import { createHash, randomInt } from "node:crypto";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { sendOutbound } from "@/lib/notifications/outbound";

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** In the test environment every phone number uses this code and no SMS is sent. */
export const LOCAL_FIXED_CODE = "123456";

const hashCode = (phone: string, code: string) =>
  createHash("sha256").update(`${phone}:${code}`).digest("hex");

/** Creates a login code for the phone and "sends" it by SMS. */
export async function requestLoginCode(phone: string) {
  const code = isLocalEnv ? LOCAL_FIXED_CODE : String(randomInt(0, 1_000_000)).padStart(6, "0");

  await sql`update login_codes set consumed_at = now() where phone = ${phone} and consumed_at is null`;
  await sql`
    insert into login_codes (phone, code_hash, expires_at)
    values (${phone}, ${hashCode(phone, code)}, now() + make_interval(mins => ${CODE_MINUTES}))`;

  await sendOutbound({
    channel: "sms",
    recipient: phone,
    body: `Chegô: seu código é ${code}. Ele vale por ${CODE_MINUTES} minutos. Não passe para ninguém.`,
  });
}

export type VerifyResult =
  | { ok: true; profileId: string }
  | { ok: false; reason: "invalid" | "expired" };

/** Checks the code and returns the profile, creating it on the first login. */
export async function verifyLoginCode(phone: string, code: string): Promise<VerifyResult> {
  return sql.begin(async (tx): Promise<VerifyResult> => {
    const [entry] = await tx<{ id: string; code_hash: string; attempts: number; expired: boolean }[]>`
      select id, code_hash, attempts, expires_at <= now() as expired
      from login_codes
      where phone = ${phone} and consumed_at is null
      order by created_at desc
      limit 1
      for update`;

    if (!entry || entry.expired || entry.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "expired" };

    if (entry.code_hash !== hashCode(phone, code)) {
      await tx`update login_codes set attempts = attempts + 1 where id = ${entry.id}`;
      return { ok: false, reason: "invalid" };
    }
    await tx`update login_codes set consumed_at = now() where id = ${entry.id}`;

    const [existing] = await tx<{ id: string }[]>`
      select id from profiles where phone = ${phone} and deleted_at is null`;
    if (existing) return { ok: true, profileId: existing.id };

    const [created] = await tx<{ id: string }[]>`
      insert into profiles (phone, role, referral_code)
      values (${phone}, 'customer', ${`CHEGO${randomInt(100000, 999999)}`})
      returning id`;
    return { ok: true, profileId: created.id };
  }) as Promise<VerifyResult>;
}
