import type postgres from "postgres";

// Caixa de areia financeira: dados sintéticos isolados numa cidade inativa própria, para
// testar o modelo de receita sem tocar em nada real. Só roda no ambiente de testes, num
// banco desta máquina; a limpeza apaga somente o que pertence a essa cidade.

export const SANDBOX_CITY_SLUG = "sandbox-financeiro-teste";
export const SANDBOX_PREFIX = "[TESTE]";

/** Recusa rodar fora do ambiente de testes ou num banco que não seja desta máquina. */
export function assertSandboxAllowed(env: { APP_ENV?: string; DATABASE_URL?: string }) {
  if (env.APP_ENV !== "local") throw new Error("A caixa de areia financeira só roda com APP_ENV=local.");
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    throw new Error("DATABASE_URL inválida.");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`A caixa de areia financeira só roda num banco local (encontrado: ${host}).`);
  }
}

/** Apaga só os dados da cidade da caixa de areia, na ordem das dependências. */
export async function cleanSandbox(sql: postgres.Sql) {
  await sql.begin(async (tx) => {
    const [city] = await tx<{ id: string }[]>`select id from cities where slug = ${SANDBOX_CITY_SLUG}`;
    if (!city) return;
    const stores = tx`select id from stores where city_id = ${city.id}`;
    const orders = tx`select id from orders where city_id = ${city.id}`;
    const profiles = tx`select id from profiles where city_id = ${city.id}`;
    const closings = tx`select id from store_closings where store_id in (${stores})`;
    await tx`delete from fee_payments where charge_id in (select id from fee_charges where closing_id in (${closings}))`;
    await tx`delete from fee_charges where store_id in (${stores})`;
    // Estornos apontam para os originais: apaga primeiro quem aponta.
    await tx`delete from fee_entries where store_id in (${stores}) and reverses_id is not null`;
    await tx`delete from fee_entries where store_id in (${stores})`;
    await tx`delete from store_closings where store_id in (${stores})`;
    await tx`delete from ledger_entries where order_id in (${orders}) or store_id in (${stores})`;
    await tx`delete from courier_earnings where order_id in (${orders})`;
    await tx`delete from refunds where order_id in (${orders})`;
    await tx`delete from orders where city_id = ${city.id}`;
    // A auditoria é imutável; só a limpeza de dados sintéticos se identifica como retenção.
    await tx`select set_config('chego.audit_retention', 'on', true)`;
    await tx`delete from audit_logs where store_id in (${stores}) or actor_id in (${profiles})`;
    await tx`delete from stores where city_id = ${city.id}`;
    await tx`delete from outbound_messages where profile_id in (${profiles})`;
    await tx`delete from profiles where city_id = ${city.id}`;
    await tx`delete from cities where id = ${city.id}`;
  });
}
