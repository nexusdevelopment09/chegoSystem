import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// O relógio da simulação: cada passo do pedido acontece alguns minutos depois do anterior.
const clock = vi.hoisted(() => ({ value: new Date() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/clock", () => ({ now: async () => clock.value, isClockSimulated: async () => false, setSimulatedNow: async () => {} }));

import type { CurrentProfile } from "@/lib/auth/session";
import { productStatus } from "@/lib/catalog/availability";
import { loadProducts, type ProductDetail } from "@/lib/catalog/queries";
import { placeOrder } from "@/lib/checkout/place-order";
import { buildQuote, type CartInput } from "@/lib/checkout/quote";
import { sql as appSql } from "@/lib/db";
import { formatCents } from "@/lib/format";
import type { OrderStatus } from "@/lib/orders/status";
import { transitionOrder } from "@/lib/orders/transitions";
import { storeAvailability, type Shift } from "@/lib/stores/hours";
import { MINUTE_MS } from "@/lib/time";

// Simula um pedido completo em cada loja ativa, pelo mesmo código que o app usa:
// monta a sacola, calcula no servidor, cria o pedido, o gateway de mentira avisa
// o pagamento, a loja aceita, prepara, e o pedido é entregue (pelo entregador da
// loja ou da rede do Chegô) ou retirado. No fim confere o dinheiro de cada pedido.
//
//   npm run simulate        roda no banco que você usa à mão (os pedidos aparecem nas telas)
//   npm run simulate:test   roda no banco de teste

const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });

type Store = {
  id: string; name: string; slug: string; city_id: string; status: "active" | "paused"; manual_state: "auto" | "open" | "closed";
  paused_until: Date | null; offers_delivery: boolean; offers_pickup: boolean; delivery_provider: "store" | "platform";
  shifts: Shift[]; courier_id: string | null; owner_id: string;
};
type Customer = CurrentProfile & { addressId: string; neighborhoodId: string };
type Result = { loja: string; pedido: string; entrega: string; total: string; resultado: string };

const results: Result[] = [];
const failures: string[] = [];

afterAll(async () => {
  console.log("\nSimulação de pedidos, uma loja por linha:");
  console.table(results);
  if (failures.length > 0) console.log(`\nProblemas encontrados:\n- ${failures.join("\n- ")}`);
  await Promise.all([appSql.end(), sql.end()]);
});

/** O momento mais recente (até 8 dias atrás) em que a loja estava aberta pela grade de horários. */
function lastOpenMoment(store: Store, from: Date): Date | null {
  for (let step = 0; step < 8 * 48; step += 1) {
    const at = new Date(from.getTime() - step * 30 * MINUTE_MS);
    const state = storeAvailability({ status: store.status, manualState: "auto", pausedUntil: null, shifts: store.shifts, closures: [] }, at);
    // Com pelo menos uma hora de loja aberta pela frente, para o pedido inteiro caber no turno.
    if (state.state === "open" && state.closesAt && state.closesAt.getTime() - at.getTime() >= 60 * MINUTE_MS) return at;
  }
  return null;
}

/** As escolhas obrigatórias de um produto, com as primeiras opções disponíveis. */
function requiredPicks(product: ProductDetail): CartInput["items"][number]["picks"] | null {
  const picks: CartInput["items"][number]["picks"] = [];
  for (const group of product.groups) {
    const needed = Math.max(group.min, group.required ? 1 : 0);
    if (needed === 0) continue;
    const available = group.options.filter((option) => option.available);
    if (available.length === 0) return null;
    if (group.allowRepeat) {
      picks.push({ groupId: group.id, optionId: available[0].id, quantity: needed });
    } else {
      if (available.length < needed) return null;
      for (const option of available.slice(0, needed)) picks.push({ groupId: group.id, optionId: option.id, quantity: 1 });
    }
  }
  return picks;
}

/** Quanto cada conta tem nos lançamentos de um pedido (créditos menos débitos). */
async function balances(orderId: string) {
  const rows = await sql<{ account: string; balance: number }[]>`
    select account::text, sum(case when direction = 'credit' then amount_cents else -amount_cents end)::int as balance
    from ledger_entries where order_id = ${orderId} group by account`;
  const of = (account: string) => rows.find((row) => row.account === account)?.balance ?? 0;
  return { store: of("store"), platform: of("platform"), courier: of("courier") };
}

async function simulate(store: Store, index: number, customers: Customer[], networkCouriers: string[]) {
  const label = (status: string): Result => ({ loja: store.name, pedido: "—", entrega: "—", total: "—", resultado: status });

  // Algumas lojas têm regra de horário além da grade (a quentinha só aceita pedido para o dia até as 11h).
  // Por isso o horário vai recuando até a cotação do servidor aceitar o pedido.
  let reason = "a loja não abriu nenhuma vez nos últimos 8 dias";
  let from = new Date();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const moment = lastOpenMoment(store, from);
    if (!moment) break;
    const result = await simulateAt(store, index, customers, networkCouriers, moment);
    if (typeof result !== "string") return result;
    reason = result;
    from = new Date(moment.getTime() - 30 * MINUTE_MS);
  }
  return label(`ERRO: ${reason}`);
}

/** Tenta o pedido em um momento. Devolve o resultado, ou o motivo (texto) quando aquele horário não serve. */
async function simulateAt(store: Store, index: number, customers: Customer[], networkCouriers: string[], startedAt: Date): Promise<Result | string> {
  const label = (status: string): Result => ({ loja: store.name, pedido: "—", entrega: "—", total: "—", resultado: status });
  clock.value = startedAt;

  // Um cliente cujo bairro a loja atende; sem nenhum, o pedido é para retirar no balcão.
  const served = new Set((await sql<{ neighborhood_id: string }[]>`select neighborhood_id from store_delivery_areas where store_id = ${store.id}`).map((row) => row.neighborhood_id));
  const reachable = customers.filter((customer) => served.has(customer.neighborhoodId));
  // De cinco em cinco lojas, um pedido para retirar no balcão, para exercitar os dois caminhos.
  // Turno "só retirada" (ex.: a Peixaria no domingo) também obriga a retirar no balcão.
  const pickupOnlyNow = storeAvailability({ status: store.status, manualState: "auto", pausedUntil: null, shifts: store.shifts, closures: [] }, startedAt).pickupOnly === true;
  const pickup = store.offers_pickup && (pickupOnlyNow || !store.offers_delivery || reachable.length === 0 || index % 5 === 4);
  if (!pickup && reachable.length === 0) return label("ERRO: nenhum cliente de teste mora onde a loja entrega, e ela não aceita retirada");
  const customer = (pickup ? customers : reachable)[index % (pickup ? customers : reachable).length];

  // Até dois produtos que podem ser pedidos naquele momento, variando conforme a loja.
  const ids = (await sql<{ id: string }[]>`select id from products where store_id = ${store.id} and deleted_at is null order by name`).map((row) => row.id);
  const details = await loadProducts(ids);
  const orderable = ids.flatMap((id) => details.get(id) ?? []).filter((product) => {
    const status = productStatus(product.rules, startedAt);
    return status.orderable && !status.mustSchedule && requiredPicks(product) !== null;
  });
  if (orderable.length === 0) return "nenhum produto pode ser pedido no horário de funcionamento";
  const chosen = [orderable[index % orderable.length], orderable[(index * 3 + 1) % orderable.length]].filter((product, position, list) => list.indexOf(product) === position);

  const cart: CartInput = {
    storeId: store.id,
    items: chosen.map((product, position) => ({ key: `item-${position}`, productId: product.id,
      // Por peso, a quantidade é em passos de precisão: começa no mínimo de gramas do produto.
      quantity: product.weightStepGrams ? Math.ceil((product.weightMinGrams ?? product.weightStepGrams) / product.weightStepGrams) : 1, notes: position === 0 ? "Pedido de simulação" : "", picks: requiredPicks(product)! })),
    fulfillment: pickup ? "pickup" : "delivery", addressId: pickup ? null : customer.addressId,
    ageConfirmed: true, missingItemPolicy: "remove", notes: "", paymentMethod: "pix",
  };
  // Completa o pedido mínimo aumentando a quantidade do primeiro item.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const built = await buildQuote(cart, customer, startedAt, { mode: "place" });
    if ("fatal" in built) return label(`ERRO: ${built.fatal}`);
    if (built.quote.missingForMinCents > 0) { cart.items[0].quantity += 1; continue; }
    // Recusado por causa do horário (e não do pedido): tenta um horário anterior.
    if (!built.quote.ok && !built.quote.orderNow.allowed) return built.quote.orderNow.reason ?? built.quote.errors.join(" | ");
    break;
  }

  const placed = await placeOrder(cart, customer, startedAt);
  if (!placed.ok) return label(`ERRO ao criar o pedido: ${placed.errors.join(" | ")}`);
  const [order] = await sql<{ code: string; total_cents: number; store_amount_cents: number; platform_amount_cents: number; courier_fee_cents: number; delivery_provider: string; delivery_code: string | null }[]>`
    select code, total_cents, store_amount_cents, platform_amount_cents, courier_fee_cents, delivery_provider, delivery_code from orders where id = ${placed.orderId}`;
  const row: Result = { loja: store.name, pedido: order.code, entrega: pickup ? "retirada" : order.delivery_provider === "platform" ? "rede do Chegô" : "da loja", total: formatCents(order.total_cents), resultado: "" };
  const problems: string[] = [];
  const later = (minutes: number) => { clock.value = new Date(clock.value.getTime() + minutes * MINUTE_MS); return clock.value; };

  try {
    // O cliente paga direto à loja: o pedido já chegou nela, sem passar por gateway.
    const [sent] = await sql<{ status: string; payment_collection: string }[]>`select status, payment_collection from orders where id = ${placed.orderId}`;
    if (sent.status !== "paid" || sent.payment_collection !== "store") problems.push(`o pedido não foi direto para a loja (${sent.status})`);
    later(2);

    const move = (to: OrderStatus, actor: "staff" | "courier", actorId: string, minutes: number, courierId?: string | null) =>
      appSql.begin((tx) => transitionOrder(tx, { orderId: placed.orderId, to, actor, actorId, at: later(minutes), courierId }));
    await move("accepted", "staff", store.owner_id, 3);

    const byNetwork = !pickup && order.delivery_provider === "platform";
    let courier: string | null = null;
    if (byNetwork) {
      // Um entregador da rede pega a entrega enquanto a loja prepara (o mesmo comando do painel dele).
      courier = networkCouriers[index % networkCouriers.length] ?? null;
      if (!courier) problems.push("nenhum entregador da rede do Chegô está aprovado");
      else await sql`update orders set courier_id = ${courier}, courier_assigned_at = ${later(1)} where id = ${placed.orderId} and courier_id is null`;
    }
    await move("preparing", "staff", store.owner_id, 2);
    await move("ready", "staff", store.owner_id, 20);

    if (pickup) {
      await move("picked_up", "staff", store.owner_id, 10);
    } else if (byNetwork && courier) {
      await move("out_for_delivery", "courier", courier, 5);
      await move("delivered", "courier", courier, 15);
    } else {
      await move("out_for_delivery", "staff", store.owner_id, 4, store.courier_id);
      if (store.courier_id) await move("delivered", "courier", store.courier_id, 15);
      else await move("delivered", "staff", store.owner_id, 15);
    }

    // Conferência do pedido pronto.
    const [done] = await sql<{ status: string; paid: boolean; completed: boolean }[]>`
      select status, paid_at is not null as paid, completed_at is not null as completed from orders where id = ${placed.orderId}`;
    if (done.status !== (pickup ? "picked_up" : "delivered")) problems.push(`terminou como "${done.status}"`);
    if (!done.paid || !done.completed) problems.push("faltou a data de pagamento ou de conclusão");

    // O dinheiro do pedido fica todo com a loja, fora do app: nenhum lançamento de venda, nenhum pagamento.
    if (order.store_amount_cents !== order.total_cents) problems.push(`a loja deveria ficar com o total, ficou com ${formatCents(order.store_amount_cents)}`);
    const money = await balances(placed.orderId);
    if (money.store !== 0 || money.platform !== 0 || money.courier !== 0) problems.push("apareceram lançamentos de venda num pedido pago direto à loja");
    const [{ payments }] = await sql<{ payments: number }[]>`select count(*)::int as payments from payments where order_id = ${placed.orderId}`;
    if (payments !== 0) problems.push("apareceu um pagamento pelo app");

    // A taxa do Chegô nasce uma vez, na conclusão.
    const fees = await sql<{ amount_cents: number }[]>`select amount_cents from fee_entries where order_id = ${placed.orderId} and kind = 'order_fee'`;
    if (fees.length !== 1 || fees[0].amount_cents !== 50) problems.push(`taxa do Chegô: ${fees.map((fee) => fee.amount_cents).join(", ") || "nenhuma"}, esperado uma de 50 centavos`);

    // O entregador da rede fica para a loja pagar, pelo valor da oferta.
    const earnings = await sql<{ amount_cents: number; payer: string; status: string }[]>`select amount_cents, payer, status from courier_earnings where order_id = ${placed.orderId}`;
    if (byNetwork && courier && order.courier_fee_cents > 0) {
      const [earning] = earnings;
      if (!earning || earning.payer !== "store" || earning.status !== "pending" || earning.amount_cents !== order.courier_fee_cents) {
        problems.push("o ganho do entregador não ficou para a loja pagar pelo valor da oferta");
      }
    } else if (earnings.length > 0) problems.push("apareceu ganho de entregador da rede numa entrega da loja");
    const [{ items }] = await sql<{ items: number }[]>`select count(*)::int as items from order_items where order_id = ${placed.orderId}`;
    if (items !== cart.items.length) problems.push("os itens gravados não batem com a sacola");
    const [{ notices }] = await sql<{ notices: number }[]>`select count(*)::int as notices from notifications where order_id = ${placed.orderId} and profile_id = ${customer.id}`;
    if (notices === 0) problems.push("o cliente não recebeu nenhum aviso do pedido");
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  row.resultado = problems.length === 0 ? "OK" : `ERRO: ${problems.join("; ")}`;
  return row;
}

describe("simulação de pedidos", () => {
  it("faz um pedido completo em cada loja ativa e o dinheiro fecha em todos", async () => {
    const stores = await sql<Store[]>`
      select s.id, s.name, s.slug, s.city_id, s.status, s.manual_state, s.paused_until, s.offers_delivery, s.offers_pickup, s.delivery_provider, s.owner_id,
             coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text, 'pickupOnly', h.pickup_only))
                       from store_hours h where h.store_id = s.id), '[]') as shifts,
             (select m.profile_id from store_members m where m.store_id = s.id and m.role = 'courier' limit 1) as courier_id
      from stores s join cities c on c.id = s.city_id
      where s.status = 'active' and c.active and not c.maintenance_mode and s.manual_state <> 'closed'
      order by s.name`;
    expect(stores.length).toBeGreaterThan(0);

    // Clientes de teste que podem comprar qualquer coisa: adultos, sem bloqueio e com endereço.
    const customers = (await sql<{ id: string; full_name: string; phone: string | null; birth_date: string | null; city_id: string | null; address_id: string; neighborhood_id: string }[]>`
      select distinct on (p.id) p.id, p.full_name, p.phone, p.birth_date::text, p.city_id, a.id as address_id, a.neighborhood_id
      from profiles p join addresses a on a.profile_id = p.id and a.deleted_at is null
      where p.role = 'customer' and p.deleted_at is null and p.blocked_at is null and p.full_name <> ''
        and (p.birth_date is null or p.birth_date <= current_date - interval '18 years')
      order by p.id, a.is_default desc`).map((row): Customer => ({
        id: row.id, fullName: row.full_name, phone: row.phone, role: "customer", blocked: false, birthDate: row.birth_date, cityId: row.city_id,
        addressId: row.address_id, neighborhoodId: row.neighborhood_id,
      }));
    expect(customers.length).toBeGreaterThan(0);
    const networkCouriers = (await sql<{ profile_id: string }[]>`select profile_id from couriers where status = 'active' order by profile_id`).map((row) => row.profile_id);

    for (const [index, store] of stores.entries()) {
      const result = await simulate(store, index, customers, networkCouriers);
      results.push(result);
      if (result.resultado !== "OK") failures.push(`${store.name}: ${result.resultado}`);
    }

    expect(failures, "Lojas em que a simulação encontrou problema").toEqual([]);
  });
});
