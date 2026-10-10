import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";

// O único lugar em que o app pergunta "que horas são?". Nunca chame `new Date()` para
// a hora atual em outro lugar: no ambiente de testes a página /dev pode mexer no
// relógio (horários das lojas, limite do almoço, itens de café da manhã, recusa automática...).
//
// A diferença fica guardada no banco, então todo navegador e toda tarefa
// agendada veem a mesma hora simulada.
const SETTING_KEY = "dev_clock_offset_ms";

const readOffset = cache(async (): Promise<number> => {
  if (!isLocalEnv) return 0;
  const [row] = await sql<{ value: unknown }[]>`
    select value from platform_settings where key = ${SETTING_KEY}`;
  return typeof row?.value === "number" ? row.value : 0;
});

export async function now(): Promise<Date> {
  // A hora atual é um dado da requisição: nunca pode ficar gravada em uma
  // página pré-montada.
  await connection();
  return new Date(Date.now() + (await readOffset()));
}

export async function isClockSimulated(): Promise<boolean> {
  return (await readOffset()) !== 0;
}

/** Só no ambiente de testes. Passe `null` para voltar ao horário real. */
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
