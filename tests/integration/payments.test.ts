import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { sql } from "./helpers";

// `now()` pede ao Next uma requisição em andamento; aqui não há Next rodando.
vi.mock("next/server", () => ({ connection: async () => {} }));

import type { CurrentProfile } from "@/lib/auth/session";
import { placeOrder } from "@/lib/checkout/place-order";
import { buildQuote, type CartInput } from "@/lib/checkout/quote";
import { sql as appSql } from "@/lib/db";
import { transitionOrder } from "@/lib/orders/transitions";
import { buildMockWebhook } from "@/lib/payments/mock";
import { refundOrder } from "@/lib/payments/refunds";
import { handlePaymentWebhook } from "@/lib/payments/webhook";

// Estes testes chamam o mesmo código que o app usa para criar pedido, receber o aviso
// do gateway, reembolsar e mudar o status, gravando de verdade no banco de teste.

// Uma sexta às 15h (horário de Maceió): o Mercado Boa Compra está aberto.
const AT = new Date("2026-10-09T15:00:00-03:00");

type Product = { id: string; price_cents: number; stock_qty: number };

let customer: CurrentProfile;
let addressId: string;
let market: { id: string; min_order_cents: number };
let product: Product;
let quantity: number;

const stockOf = async (id: string) => (await sql<{ stock_qty: number }[]>`select stock_qty from products where id = ${id}`)[0].stock_qty;

/** Soma dos lançamentos de um pedido: créditos menos débitos, por conta. */
async function ledgerOf(orderId: string) {
  const rows = await sql<{ account: string; balance: number; lines: number }[]>`
    select account::text, count(*)::int as lines,
           sum(case when direction = 'credit' then amount_cents else -amount_cents end)::int as balance
    from ledger_entries where order_id = ${orderId} group by account`;
  const of = (account: string) => rows.find((row) => row.account === account);
  return {
    store: of("store")?.balance ?? 0,
    platform: of("platform")?.balance ?? 0,
    lines: rows.reduce((total, row) => total + row.lines, 0),
  };
}

function cart(overrides: Partial<CartInput["items"][number]> = {}, units = quantity): CartInput {
  return {
    storeId: market.id,
    items: [{ key: "item-1", productId: product.id, quantity: units, notes: "", picks: [], ...overrides }],
    fulfillment: "delivery", addressId, ageConfirmed: false, missingItemPolicy: "remove", notes: "", paymentMethod: "pix",
  };
}

/** Cria um pedido e, se pedido, faz o gateway de mentira avisar que foi pago. */
async function order(options: { paid: boolean }) {
  const placed = await placeOrder(cart(), customer, AT);
  if (!placed.ok) throw new Error(`O pedido não foi criado: ${placed.errors.join(" | ")}`);
  if (options.paid) {
    const { rawBody, signature } = buildMockWebhook(placed.providerPaymentId, "payment.approved");
    expect(await handlePaymentWebhook(rawBody, signature)).toBe("processed");
  }
  return placed;
}

beforeAll(async () => {
  const [profile] = await sql<{ id: string; full_name: string; phone: string; birth_date: string | null; city_id: string | null }[]>`
    select id, full_name, phone, birth_date::text, city_id from profiles where full_name = 'Diego Alves'`;
  customer = { id: profile.id, fullName: profile.full_name, phone: profile.phone, role: "customer", blocked: false, birthDate: profile.birth_date, cityId: profile.city_id };
  [{ id: addressId }] = await sql<{ id: string }[]>`select id from addresses where profile_id = ${profile.id} and deleted_at is null limit 1`;
  [market] = await sql<{ id: string; min_order_cents: number }[]>`select id, min_order_cents from stores where slug = 'mercado-boa-compra'`;

  // O produto simples (sem opções) mais caro do mercado, com estoque controlado e folga para vários pedidos.
  [product] = await sql<Product[]>`
    select p.id, p.price_cents, p.stock_qty from products p
    where p.store_id = ${market.id} and p.track_stock and p.available and p.deleted_at is null and not p.requires_age_check
      and not exists (select 1 from product_option_groups g where g.product_id = p.id)
      and not exists (select 1 from product_availability a where a.product_id = p.id)
      and p.max_per_order is null and p.stock_qty >= 40
    order by p.price_cents desc limit 1`;
  quantity = Math.max(2, Math.ceil(market.min_order_cents / product.price_cents));
  expect(product.stock_qty).toBeGreaterThanOrEqual(quantity * 8);
});

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  // Devolve o banco de teste ao estado do seed, para os outros arquivos não verem estes pedidos.
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("webhook de pagamento", () => {
  it("recebido duas vezes não duplica nada", async () => {
    const placed = await order({ paid: false });
    expect((await sql`select status from orders where id = ${placed.orderId}`)[0].status).toBe("awaiting_payment");

    const { rawBody, signature } = buildMockWebhook(placed.providerPaymentId, "payment.approved");
    expect(await handlePaymentWebhook(rawBody, signature)).toBe("processed");

    const snapshot = async () => ({
      ledger: await ledgerOf(placed.orderId),
      history: (await sql`select status from order_status_history where order_id = ${placed.orderId} order by created_at, status`).map((row) => row.status),
      notifications: (await sql`select count(*)::int as total from notifications where order_id = ${placed.orderId}`)[0].total,
      events: (await sql`select count(*)::int as total from webhook_events`)[0].total,
      payments: await sql`select status from payments where order_id = ${placed.orderId}`,
    });
    const first = await snapshot();
    expect(first.history).toEqual(["awaiting_payment", "paid"]);
    expect(first.payments).toEqual([{ status: "approved" }]);

    // O gateway repete o mesmo aviso (mesmo id de evento).
    expect(await handlePaymentWebhook(rawBody, signature)).toBe("duplicate");
    expect(await snapshot()).toEqual(first);

    const [saved] = await sql<{ status: string; store_amount_cents: number; platform_amount_cents: number; total_cents: number }[]>`
      select status, store_amount_cents, platform_amount_cents, total_cents from orders where id = ${placed.orderId}`;
    expect(saved.status).toBe("paid");
    expect(first.ledger.store).toBe(saved.store_amount_cents);
    expect(first.ledger.platform).toBe(saved.platform_amount_cents);
    expect(first.ledger.store + first.ledger.platform).toBe(saved.total_cents);
  });

  it("com assinatura errada não muda nada", async () => {
    const placed = await order({ paid: false });
    const { rawBody } = buildMockWebhook(placed.providerPaymentId, "payment.approved");

    expect(await handlePaymentWebhook(rawBody, "assinatura-falsa")).toBe("invalid_signature");
    expect(await handlePaymentWebhook(rawBody, null)).toBe("invalid_signature");

    expect((await sql`select status from orders where id = ${placed.orderId}`)[0].status).toBe("awaiting_payment");
    expect((await ledgerOf(placed.orderId)).lines).toBe(0);
  });
});

describe("checkout", () => {
  it("ignora o preço adulterado pelo navegador: vale o do banco", async () => {
    const placed = await placeOrder(cart({ expectedUnitPriceCents: 1 }), customer, AT);
    if (!placed.ok) throw new Error(placed.errors.join(" | "));

    const [saved] = await sql<{ subtotal_cents: number; total_cents: number }[]>`select subtotal_cents, total_cents from orders where id = ${placed.orderId}`;
    expect(saved.subtotal_cents).toBe(product.price_cents * quantity);
    expect(saved.total_cents).toBeGreaterThan(saved.subtotal_cents);

    const [item] = await sql<{ unit_price_cents: number }[]>`select unit_price_cents from order_items where order_id = ${placed.orderId}`;
    expect(item.unit_price_cents).toBe(product.price_cents);
    // O gateway recebeu o valor calculado no servidor.
    expect((await sql`select amount_cents from payments where order_id = ${placed.orderId}`)[0].amount_cents).toBe(saved.total_cents);

    // E a cotação avisa o cliente de que o preço não é o que ele viu.
    const built = await buildQuote(cart({ expectedUnitPriceCents: 1 }), customer, AT, { mode: "preview" });
    if ("fatal" in built) throw new Error(built.fatal);
    expect(built.quote.lines[0].priceChanged).toBe(true);
    expect(built.quote.warnings.join(" ")).toContain("mudou para");
  });

  it("cobra a taxa do bairro e avisa quando a loja não entrega lá", async () => {
    const hood = async (name: string) => (await sql<{ id: string }[]>`select id from neighborhoods where name = ${name}`)[0].id;
    const deliveryTo = async (storeId: string, neighborhood: string) => {
      const built = await buildQuote({ ...cart(), storeId, addressId: null }, null, AT, { mode: "preview", fallbackNeighborhoodId: await hood(neighborhood) });
      if ("fatal" in built) throw new Error(built.fatal);
      return { ...built.quote.delivery, charged: built.quote.totals.deliveryFeeCents };
    };

    expect(await deliveryTo(market.id, "Centro")).toMatchObject({ available: true, feeCents: 300, charged: 300 });
    expect(await deliveryTo(market.id, "Vila Nova")).toMatchObject({ available: true, feeCents: 400, charged: 400 });
    // O mercado atende a zona rural, com a taxa da comunidade.
    expect(await deliveryTo(market.id, "Sítio Mata Verde")).toMatchObject({ available: true, feeCents: 1200, charged: 1200 });

    // A pizzaria só atende uma das comunidades rurais.
    const [pizzaria] = await sql<{ id: string }[]>`select id from stores where slug = 'pizzaria-forno-de-barro'`;
    expect(await deliveryTo(pizzaria.id, "Sítio Riacho Fundo")).toMatchObject({ available: true, feeCents: 800 });
    const refused = await deliveryTo(pizzaria.id, "Sítio Mata Verde");
    expect(refused).toMatchObject({ available: false, charged: 0 });
    expect(refused.reason).toContain("Sítio Mata Verde");
  });
});

describe("estoque", () => {
  it("baixa na compra e volta no cancelamento", async () => {
    const before = await stockOf(product.id);

    const placed = await order({ paid: true });
    expect(await stockOf(product.id)).toBe(before - quantity);

    // O cliente desiste antes de a loja aceitar: reembolso total e estoque de volta.
    await appSql.begin((tx) => transitionOrder(tx, { orderId: placed.orderId, to: "cancelled", actor: "customer", actorId: customer.id, at: AT, reason: "Desisti" }));
    expect(await stockOf(product.id)).toBe(before);

    const [saved] = await sql<{ status: string; refunded_cents: number; total_cents: number }[]>`select status, refunded_cents, total_cents from orders where id = ${placed.orderId}`;
    expect(saved).toMatchObject({ status: "cancelled", refunded_cents: saved.total_cents });
    expect(await ledgerOf(placed.orderId)).toMatchObject({ store: 0, platform: 0 });
  });

  it("volta quando o Pix expira e não deixa vender mais do que existe", async () => {
    const before = await stockOf(product.id);

    const placed = await order({ paid: false });
    expect(await stockOf(product.id)).toBe(before - quantity);
    const { rawBody, signature } = buildMockWebhook(placed.providerPaymentId, "payment.expired");
    expect(await handlePaymentWebhook(rawBody, signature)).toBe("processed");
    expect((await sql`select status from orders where id = ${placed.orderId}`)[0].status).toBe("expired");
    expect(await stockOf(product.id)).toBe(before);

    const tooMany = await placeOrder(cart({}, before + 1), customer, AT);
    expect(tooMany.ok).toBe(false);
    expect(await stockOf(product.id)).toBe(before);
  });
});

describe("reembolso parcial", () => {
  it("gera os estornos certos nos lançamentos, na proporção da venda", async () => {
    const placed = await order({ paid: true });
    const [sale] = await sql<{ store_amount_cents: number; platform_amount_cents: number; total_cents: number }[]>`
      select store_amount_cents, platform_amount_cents, total_cents from orders where id = ${placed.orderId}`;
    const partial = product.price_cents;

    const first = await appSql.begin((tx) => refundOrder(tx, { orderId: placed.orderId, amountCents: partial, reason: "Item em falta", requestedBy: null, at: AT }));
    expect(first).toEqual({ refundedCents: partial, fully: false });

    const [refund] = await sql<{ amount_cents: number; store_share_cents: number; platform_share_cents: number }[]>`
      select amount_cents, store_share_cents, platform_share_cents from refunds where order_id = ${placed.orderId}`;
    const expectedStoreShare = Math.round((partial * sale.store_amount_cents) / sale.total_cents);
    expect(refund).toEqual({ amount_cents: partial, store_share_cents: expectedStoreShare, platform_share_cents: partial - expectedStoreShare });

    // Os estornos são débitos, um por lado, ligados ao reembolso.
    const lines = await sql<{ account: string; direction: string; amount_cents: number }[]>`
      select account::text, direction::text, amount_cents from ledger_entries
      where order_id = ${placed.orderId} and reason = 'refund' order by account`;
    expect(lines).toEqual([
      ...(refund.platform_share_cents > 0 ? [{ account: "platform", direction: "debit", amount_cents: refund.platform_share_cents }] : []),
      { account: "store", direction: "debit", amount_cents: refund.store_share_cents },
    ]);

    const afterPartial = await ledgerOf(placed.orderId);
    expect(afterPartial.store).toBe(sale.store_amount_cents - refund.store_share_cents);
    expect(afterPartial.platform).toBe(sale.platform_amount_cents - refund.platform_share_cents);
    expect((await sql`select refunded_cents from orders where id = ${placed.orderId}`)[0].refunded_cents).toBe(partial);
    expect((await sql`select status from payments where order_id = ${placed.orderId}`)[0].status).toBe("partially_refunded");

    // Não devolve mais do que ainda falta.
    await expect(appSql.begin((tx) => refundOrder(tx, { orderId: placed.orderId, amountCents: sale.total_cents, reason: "Demais", requestedBy: null, at: AT })))
      .rejects.toThrow("maior do que o valor");

    // Devolvendo o resto, os dois lados zeram exatamente, sem sobrar centavo.
    const rest = await appSql.begin((tx) => refundOrder(tx, { orderId: placed.orderId, amountCents: "all", reason: "Resto", requestedBy: null, at: AT }));
    expect(rest).toEqual({ refundedCents: sale.total_cents - partial, fully: true });
    expect(await ledgerOf(placed.orderId)).toMatchObject({ store: 0, platform: 0 });
    expect((await sql`select status from payments where order_id = ${placed.orderId}`)[0].status).toBe("refunded");
  });
});
