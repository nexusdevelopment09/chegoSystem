import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";

// The only place the app asks "what time is it?". Never call `new Date()` for
// the current time elsewhere: in the test environment the /dev page can move
// the clock (store hours, lunch cutoff, breakfast items, auto-reject...).
//
// The offset is stored in the database, so every browser and every scheduled
// task sees the same simulated time.
const SETTING_KEY = "dev_clock_offset_ms";

const readOffset = cache(async (): Promise<number> => {
  if (!isLocalEnv) return 0;
  const [row] = await sql<{ value: unknown }[]>`
    select value from platform_settings where key = ${SETTING_KEY}`;
  return typeof row?.value === "number" ? row.value : 0;
});

export async function now(): Promise<Date> {
  // The current time is request data: it must never be baked into a
  // prerendered page.
  await connection();
  return new Date(Date.now() + (await readOffset()));
}

export async function isClockSimulated(): Promise<boolean> {
  return (await readOffset()) !== 0;
}

/** Test environment only. Pass `null` to go back to the real time. */
export async function setSimulatedNow(date: Date | null) {
  if (!isLocalEnv) throw new Error("The simulated clock only exists in the test environment.");

  if (date === null) {
    await sql`delete from platform_settings where key = ${SETTING_KEY}`;
    return;
  }
  const offset = date.getTime() - Date.now();
  await sql`
    insert into platform_settings (key, value, description)
    values (${SETTING_KEY}, ${sql.json(offset)}, 'Relógio simulado do ambiente de testes')
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
