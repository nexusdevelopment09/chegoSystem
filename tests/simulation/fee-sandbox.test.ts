import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `now()` pede ao Next uma requisição em andamento; aqui não há Next rodando.
vi.mock("next/server", () => ({ connection: async () => {} }));

import { audit } from "@/lib/audit";
import { sql as appSql } from "@/lib/db";
import { handleFeeWebhook, requestFeeCharge } from "@/lib/fees/charges";
import { closeBusinessDay } from "@/lib/fees/closing";
import { recordCompletedOrderFees } from "@/lib/fees/ledger";
import { buildMockFeeWebhook } from "@/lib/fees/pix";
import { addDays, businessDate, closingTotals } from "@/lib/fees/rules";
import { formatCents } from "@/lib/format";
import { transitionOrder, type TransitionInput } from "@/lib/orders/transitions";
import { getSettings } from "@/lib/settings";
import { assertSandboxAllowed, cleanSandbox, SANDBOX_CITY_SLUG, SANDBOX_PREFIX } from "./sandbox";

// Caixa de areia financeira: 10 lojas sintéticas numa cidade inativa, pedidos em todas as
// situações e as taxas de R$ 0,50 geradas pelo MESMO código do app (transitionOrder,
// recordCompletedOrderFees, closeBusinessDay, cobrança Pix de mentira). Confere a regra,
// a idempotência, os fechamentos e os pagamentos, e imprime um relatório.
//
//   npm run sandbox:fees         recria a caixa de areia no banco que você usa à mão
//   npm run sandbox:fees:clean   apaga só a caixa de areia
//   npm run simulate:test        roda junto com a simulação, no banco de teste
//
// Nada aqui é dinheiro de verdade: o Pix é o provedor de mentira (só existe com APP_ENV=local).

assertSandboxAllowed({ APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL });
const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
const ONLY_CLEAN = process.env.SANDBOX === "clean";

type Kind = "delivered" | "picked_up" | "preparing" | "out_for_delivery" | "rejected";
type SandboxOrder = { id: string; storeIndex: number; kind: Kind; day: string };

const world = {
  cityId: "", adminId: "", stores: [] as { id: string; ownerId: string; name: string }[], orders: [] as SandboxOrder[],
  feeCents: 0, cutoff: 5, days: [] as string[], closingIds: new Map<string, string>(), outsideBefore: 0,
};

const local = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const feesOf = (orderId: string) =>
  sql<{ kind: string; amount_cents: number; reverses_id: string | null }[]>`select kind::text, amount_cents, reverses_id from fee_entries where order_id = ${orderId} order by created_at`;
const move = (input: TransitionInput) => appSql.begin((tx) => transitionOrder(tx, input));

beforeAll(async () => {
  await cleanSandbox(sql);
  if (ONLY_CLEAN) return;

  const settings = await getSettings();
  world.feeCents = settings.order_fee_cents;
  world.cutoff = settings.business_day_cutoff_hour;
  const today = businessDate(new Date(), world.cutoff);
  world.days = [addDays(today, -3), addDays(today, -2), addDays(today, -1)];
  world.outsideBefore = (await sql<{ n: number }[]>`select count(*)::int as n from fee_entries`)[0].n;

  // Cidade inativa: nada daqui aparece para os clientes do app.
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name, state, slug, order_code_prefix, active) values ('Cidade Sintética (teste)', 'AL', ${SANDBOX_CITY_SLUG}, 'SBX', false) returning id`;
  world.cityId = city.id;
  const [hood] = await sql<{ id: string }[]>`insert into neighborhoods (city_id, name) values (${city.id}, 'Bairro Sintético') returning id`;
  const [category] = await sql<{ id: string }[]>`select id from categories where slug = 'restaurantes'`;
  const person = async (name: string, role: string) =>
    (await sql<{ id: string }[]>`insert into profiles (full_name, role, city_id) values (${`${SANDBOX_PREFIX} ${name}`}, ${role}::user_role, ${city.id}) returning id`)[0].id;
  world.adminId = await person("Admin da caixa de areia", "admin");
  const customers = [await person("Cliente Um", "customer"), await person("Cliente Dois", "customer")];

  for (let index = 1; index <= 10; index++) {
    const ownerId = await person(`Dono da loja ${index}`, "merchant");
    const name = `${SANDBOX_PREFIX} Loja ${String(index).padStart(2, "0")}`;
    const [store] = await sql<{ id: string }[]>`
      insert into stores (city_id, category_id, owner_id, name, slug, status, street, number, neighborhood_id)
      values (${city.id}, ${category.id}, ${ownerId}, ${name}, ${`sandbox-loja-${index}`}, 'active', 'Rua Fictícia', ${String(index)}, ${hood.id})
      returning id`;
    await sql`insert into store_private (store_id, commission_rate) values (${store.id}, 0)`;
    await sql`insert into store_members (store_id, profile_id, role) values (${store.id}, ${ownerId}, 'owner')`;
    await sql`insert into products (store_id, name, price_cents) values (${store.id}, ${`${SANDBOX_PREFIX} Produto`}, 2500)`;
    world.stores.push({ id: store.id, ownerId, name });
  }

  // Cada loja: 6 entregues e 2 retirados (espalhados pelos 3 dias), 1 em preparo,
  // 1 saiu para entrega e não chegou, 1 recusado.
  const plan: Kind[] = ["delivered", "delivered", "delivered", "delivered", "delivered", "delivered", "picked_up", "picked_up", "preparing", "out_for_delivery", "rejected"];
  let number = 0;
  for (const [storeIndex, store] of world.stores.entries()) {
    for (const [position, kind] of plan.entries()) {
      number += 1;
      const day = world.days[position % 3];
      const fulfillment = kind === "picked_up" ? "pickup" : "delivery";
      const paidAt = local(day, "12:00");
      const [order] = await sql<{ id: string }[]>`
        insert into orders (code, city_id, customer_id, store_id, status, fulfillment, customer_name, subtotal_cents, commission_rate,
                            commission_cents, store_amount_cents, platform_amount_cents, total_cents, payment_method, paid_at,
                            payment_collection, neighborhood_id, created_at)
        values (${`SBX-${number}`}, ${city.id}, ${customers[number % 2]}, ${store.id}, 'paid', ${fulfillment}, ${`${SANDBOX_PREFIX} Cliente`},
                2500, 0, 0, 2500, 0, 2500, 'cash', ${paidAt}, 'store', ${fulfillment === "delivery" ? hood.id : null}, ${paidAt})
        returning id`;
      const staff = { orderId: order.id, actor: "staff" as const, actorId: store.ownerId };
      if (kind === "rejected") {
        await move({ ...staff, to: "rejected", at: local(day, "12:05"), reason: "Fora da área (teste)" });
      } else {
        await move({ ...staff, to: "accepted", at: local(day, "12:05") });
        await move({ ...staff, to: "preparing", at: local(day, "12:10") });
        if (kind !== "preparing") {
          await move({ ...staff, to: "ready", at: local(day, "12:30") });
          if (kind === "picked_up") await move({ ...staff, to: "picked_up", at: local(day, "12:45") });
          else await move({ ...staff, to: "out_for_delivery", at: local(day, "12:40") });
          if (kind === "delivered") await move({ ...staff, to: "delivered", at: local(day, "13:00") });
        }
      }
      world.orders.push({ id: order.id, storeIndex, kind, day });
    }
  }
}, 300_000);

afterAll(async () => {
  if (!ONLY_CLEAN) await report();
  await Promise.all([sql.end(), appSql.end()]);
});

describe.skipIf(ONLY_CLEAN)("caixa de areia financeira: tarifa de R$ 0,50 por pedido concluído", () => {
  it("entregue e retirado geram exatamente uma tarifa; em preparo, não entregue e recusado não geram", async () => {
    expect(world.feeCents).toBe(50);
    for (const order of world.orders) {
      const fees = (await feesOf(order.id)).filter((fee) => fee.kind === "order_fee");
      const expected = order.kind === "delivered" || order.kind === "picked_up" ? 1 : 0;
      expect(fees, `${order.kind} ${order.id}`).toHaveLength(expected);
      if (expected) expect(fees[0].amount_cents).toBe(50);
    }
  });

  it("reprocessar, repetir o evento ou dois eventos ao mesmo tempo não cobram duas vezes", async () => {
    const order = world.orders.find((item) => item.kind === "delivered")!;
    const [row] = await sql<{ id: string; store_id: string; discount_cents: number; discount_paid_by: "platform" | "store" | null }[]>`
      select id, store_id, discount_cents, discount_paid_by from orders where id = ${order.id}`;
    const record = () => appSql.begin((tx) => recordCompletedOrderFees(tx, row, local(order.day, "13:00")));
    await record();
    await Promise.all([record(), record(), record()]);
    // Marcar como entregue de novo é recusado pela máquina de estados.
    await expect(move({ orderId: order.id, to: "delivered", actor: "staff", actorId: world.stores[order.storeIndex].ownerId, at: local(order.day, "13:05") }))
      .rejects.toThrow(/já mudou de situação/);
    expect((await feesOf(order.id)).filter((fee) => fee.kind === "order_fee")).toHaveLength(1);
  });

  it("fechamento soma só os lançamentos certos; dois cliques ao mesmo tempo fecham uma vez", async () => {
    const [firstDay, secondDay] = world.days;
    for (const day of [firstDay, secondDay]) {
      for (const store of world.stores) {
        const close = () => closeBusinessDay({ storeId: store.id, businessDate: day, at: local(addDays(day, 1), "06:00"), closedBy: store.ownerId });
        const [a, b] = await Promise.all([close(), close()]);
        expect(a.closing?.id).toBe(b.closing?.id);
        if (day === secondDay) world.closingIds.set(store.id, a.closing!.id);
      }
    }
    for (const store of world.stores) {
      const closings = await sql<{ id: string; total_due_cents: number; order_count: number }[]>`
        select id, total_due_cents, order_count from store_closings where store_id = ${store.id} order by business_date`;
      expect(closings).toHaveLength(2);
      // O segundo fechamento pega o dia 2 (e o dia 1 já ficou no primeiro): cada um bate com os seus lançamentos.
      for (const closing of closings) {
        const entries = await sql<{ kind: "order_fee"; amount_cents: number }[]>`select kind, amount_cents from fee_entries where closing_id = ${closing.id}`;
        const totals = closingTotals(entries.map((entry) => ({ kind: entry.kind, amountCents: entry.amount_cents })));
        expect(closing.total_due_cents).toBe(Math.max(totals.netCents, 0));
        expect(closing.order_count).toBe(totals.orderCount);
      }
    }
  });

  it("pagamento Pix (de mentira) quita sem apagar o histórico; repetido não paga duas vezes; valor errado vai para análise", async () => {
    const entriesBefore = (await sql<{ n: number }[]>`select count(*)::int as n from fee_entries where store_id = ${world.stores[0].id}`)[0].n;
    for (const [index, store] of world.stores.slice(0, 5).entries()) {
      const closingId = world.closingIds.get(store.id)!;
      const charge = await requestFeeCharge({ closingId, storeId: store.id, at: local(world.days[2], "08:00") });
      if (!charge.ok) throw new Error(charge.error);
      expect(charge.simulated).toBe(true);
      const amount = index === 4 ? charge.charge.amount_cents - 10 : charge.charge.amount_cents;
      const event = buildMockFeeWebhook({ type: "charge.paid", providerChargeId: charge.charge.provider_charge_id, amountCents: amount, transactionId: `SBX-TX-${index}` });
      // Valor diferente do cobrado não quita: vai para análise do admin.
      expect(await handleFeeWebhook(event.rawBody, event.signature, local(world.days[2], "08:05"))).toBe(index === 4 ? "in_review" : "processed");
      if (index === 0) expect(await handleFeeWebhook(event.rawBody, event.signature, local(world.days[2], "08:06"))).toBe("duplicate");
    }
    const statuses = await sql<{ status: string }[]>`
      select c.status::text from store_closings c where c.id = any(${[...world.closingIds.values()].slice(0, 5)}::uuid[]) order by c.status`;
    expect(statuses.map((row) => row.status).sort()).toEqual(["in_review", "paid", "paid", "paid", "paid"]);
    expect((await sql<{ n: number }[]>`select count(*)::int as n from fee_entries where store_id = ${world.stores[0].id}`)[0].n).toBe(entriesBefore);
  });

  it("ajuste e estorno ficam rastreáveis: motivo, quem fez, auditoria e ligação com o original", async () => {
    const store = world.stores[6];
    await appSql.begin(async (tx) => {
      const [entry] = await tx<{ id: string }[]>`
        insert into fee_entries (store_id, kind, amount_cents, business_date, reason, created_by)
        values (${store.id}, 'adjustment', -100, ${world.days[2]}, 'Desconto combinado com a loja (teste)', ${world.adminId}) returning id`;
      await audit({ actorId: world.adminId, action: "fees.adjustment", entityType: "fee_entry", entityId: entry.id, storeId: store.id, details: { amount_cents: -100 } }, tx);
    });
    const [adjustment] = await sql`select reason, created_by from fee_entries where store_id = ${store.id} and kind = 'adjustment'`;
    expect(adjustment).toEqual({ reason: "Desconto combinado com a loja (teste)", created_by: world.adminId });
    expect((await sql`select 1 from audit_logs where action = 'fees.adjustment' and store_id = ${store.id}`).length).toBe(1);
    // Ajuste sem motivo é recusado pelo banco.
    await expect(sql`insert into fee_entries (store_id, kind, amount_cents, business_date) values (${store.id}, 'adjustment', -1, ${world.days[2]})`).rejects.toThrow();

    // Reembolso de um pedido entregue: estorno ligado ao lançamento original.
    const order = world.orders.find((item) => item.storeIndex === 7 && item.kind === "delivered" && item.day === world.days[2])!;
    await move({ orderId: order.id, to: "refunded", actor: "admin", actorId: world.adminId, at: local(world.days[2], "18:00"), reason: "Pedido errado (teste)" });
    const fees = await feesOf(order.id);
    const original = fees.find((fee) => fee.kind === "order_fee")!;
    const reversal = fees.find((fee) => fee.kind === "order_fee_reversal")!;
    expect(reversal.amount_cents).toBe(-original.amount_cents);
    expect(reversal.reverses_id).not.toBeNull();
  });

  it("a caixa de areia não mexe em nada fora dela", async () => {
    const [outside] = await sql<{ n: number }[]>`
      select count(*)::int as n from fee_entries where store_id not in (select id from stores where city_id = ${world.cityId})`;
    expect(outside.n).toBe(world.outsideBefore);
    const [city] = await sql<{ active: boolean }[]>`select active from cities where id = ${world.cityId}`;
    expect(city.active).toBe(false);
  });
});

describe("caixa de areia financeira: proteções", () => {
  it("recusa rodar fora do ambiente de testes ou num banco remoto", () => {
    expect(() => assertSandboxAllowed({ APP_ENV: "production", DATABASE_URL: "postgres://x@127.0.0.1/chego" })).toThrow(/APP_ENV=local/);
    expect(() => assertSandboxAllowed({ APP_ENV: "local", DATABASE_URL: "postgres://chego:x@db:5432/chego" })).toThrow(/banco local/);
    expect(() => assertSandboxAllowed({ APP_ENV: "local", DATABASE_URL: "postgres://chego@127.0.0.1:54329/chego" })).not.toThrow();
  });
});

/** Relatório por loja, reconciliado: lançamentos × fechamentos × pagamentos. */
async function report() {
  const rows = await sql<{ name: string; orders: number; fees: number; adjustments: number; closed: number; paid: number; pending: number; open: number }[]>`
    select s.name,
           (select count(*) from fee_entries e where e.store_id = s.id and e.kind = 'order_fee')::int
             - (select count(*) from fee_entries e where e.store_id = s.id and e.kind = 'order_fee_reversal')::int as orders,
           coalesce((select sum(amount_cents) from fee_entries e where e.store_id = s.id and e.kind in ('order_fee', 'order_fee_reversal')), 0)::int as fees,
           coalesce((select sum(amount_cents) from fee_entries e where e.store_id = s.id and e.kind = 'adjustment'), 0)::int as adjustments,
           coalesce((select sum(total_due_cents) from store_closings c where c.store_id = s.id), 0)::int as closed,
           coalesce((select sum(p.amount_cents) from fee_payments p join fee_charges ch on ch.id = p.charge_id where ch.store_id = s.id and p.applied), 0)::int as paid,
           coalesce((select sum(total_due_cents) from store_closings c where c.store_id = s.id and c.status in ('awaiting_payment', 'overdue', 'in_review')), 0)::int as pending,
           coalesce((select sum(amount_cents) from fee_entries e where e.store_id = s.id and e.closing_id is null), 0)::int as open
    from stores s where s.city_id = ${world.cityId} order by s.name`;
  console.log("\nCaixa de areia financeira (dados sintéticos, nada é dinheiro real):");
  console.table(rows.map((row) => ({
    loja: row.name, pedidos_com_taxa: row.orders, taxas: formatCents(row.fees), ajustes: formatCents(row.adjustments),
    fechado: formatCents(row.closed), pago: formatCents(row.paid), a_receber: formatCents(row.pending), sem_fechamento: formatCents(row.open),
  })));
  const total = (pick: (row: (typeof rows)[number]) => number) => formatCents(rows.reduce((sum, row) => sum + pick(row), 0));
  console.log(`Total: ${rows.reduce((sum, row) => sum + row.orders, 0)} pedidos com taxa, ${total((row) => row.fees)} em taxas, ${total((row) => row.paid)} pagos, ${total((row) => row.pending)} a receber, ${total((row) => row.open)} sem fechamento.`);
}
