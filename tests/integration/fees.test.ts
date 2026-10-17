import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { asUser, inRolledBackTransaction, sql } from "./helpers";

// `now()` pede ao Next uma requisição em andamento; aqui não há Next rodando.
vi.mock("next/server", () => ({ connection: async () => {} }));

import type { CurrentProfile } from "@/lib/auth/session";
import { placeOrder } from "@/lib/checkout/place-order";
import type { CartInput } from "@/lib/checkout/quote";
import { sql as appSql } from "@/lib/db";
import { handleFeeWebhook, requestFeeCharge } from "@/lib/fees/charges";
import { closeBusinessDay } from "@/lib/fees/closing";
import { recordCompletedOrderFees } from "@/lib/fees/ledger";
import { buildMockFeeWebhook } from "@/lib/fees/pix";
import { transitionOrder } from "@/lib/orders/transitions";

// Pagamento direto à loja (o padrão) e as taxas do Chegô: o mesmo código do app,
// gravando de verdade no banco de teste.

// Uma sexta às 15h (horário de Maceió): o Mercado Boa Compra está aberto.
const AT = new Date("2026-10-09T15:00:00-03:00");
const at = (local: string) => new Date(`${local}-03:00`);

let customer: CurrentProfile;
let addressId: string;
let market: { id: string; owner_id: string; min_order_cents: number };
let product: { id: string; price_cents: number };
let quantity: number;

function cart(couponCode: string | null = null): CartInput {
  return {
    storeId: market.id, fulfillment: "delivery", addressId, ageConfirmed: false, missingItemPolicy: "remove", notes: "",
    paymentMethod: "pix", couponCode,
    items: [{ key: "item-1", productId: product.id, quantity, notes: "", picks: [] }],
  };
}

async function place(couponCode: string | null = null) {
  const placed = await placeOrder(cart(couponCode), customer, AT);
  if (!placed.ok) throw new Error(`O pedido não foi criado: ${placed.errors.join(" | ")}`);
  return placed.orderId;
}

/** Leva o pedido até "entregue" no instante pedido (é a conclusão que define o dia do expediente). */
async function complete(orderId: string, deliveredAt: Date) {
  const step = (to: "accepted" | "preparing" | "ready" | "out_for_delivery" | "delivered", when: Date) =>
    appSql.begin((tx) => transitionOrder(tx, { orderId, to, actor: "staff", actorId: market.owner_id, at: when }));
  await step("accepted", AT);
  await step("preparing", AT);
  await step("ready", AT);
  await step("out_for_delivery", AT);
  await step("delivered", deliveredAt);
}

const feesOf = (orderId: string) =>
  sql<{ id: string; kind: string; amount_cents: number; business_date: string; reverses_id: string | null }[]>`
    select id, kind::text, amount_cents, business_date::text, reverses_id from fee_entries where order_id = ${orderId} order by created_at`;

const openNet = async () =>
  (await sql<{ net: number }[]>`select coalesce(sum(amount_cents), 0)::int as net from fee_entries where store_id = ${market.id} and closing_id is null`)[0].net;

beforeAll(async () => {
  const [profile] = await sql<{ id: string; full_name: string; phone: string; birth_date: string | null; city_id: string | null }[]>`
    select id, full_name, phone, birth_date::text, city_id from profiles where full_name = 'Diego Alves'`;
  customer = { id: profile.id, fullName: profile.full_name, phone: profile.phone, role: "customer", blocked: false, birthDate: profile.birth_date, cityId: profile.city_id };
  [{ id: addressId }] = await sql<{ id: string }[]>`select id from addresses where profile_id = ${profile.id} and deleted_at is null limit 1`;
  [market] = await sql<{ id: string; owner_id: string; min_order_cents: number }[]>`select id, owner_id, min_order_cents from stores where slug = 'mercado-boa-compra'`;
  [product] = await sql<{ id: string; price_cents: number }[]>`
    select p.id, p.price_cents from products p
    where p.store_id = ${market.id} and p.available and p.deleted_at is null and not p.requires_age_check
      and not exists (select 1 from product_option_groups g where g.product_id = p.id)
      and not exists (select 1 from product_availability a where a.product_id = p.id)
      and p.max_per_order is null and (not p.track_stock or p.stock_qty >= 40)
    order by p.price_cents desc limit 1`;
  quantity = Math.max(2, Math.ceil(market.min_order_cents / product.price_cents));
});

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  // Devolve o banco de teste ao estado do seed, para os outros arquivos não verem estes pedidos.
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("pagamento direto à loja", () => {
  it("o pedido vai para a loja na hora, sem pagamento no app e sem taxa para o cliente", async () => {
    const orderId = await place();
    const [order] = await sql<{ status: string; payment_collection: string; service_fee_cents: number; commission_cents: number; store_amount_cents: number; total_cents: number; paid_at: Date | null }[]>`
      select status, payment_collection::text, service_fee_cents, commission_cents, store_amount_cents, total_cents, paid_at from orders where id = ${orderId}`;
    expect(order).toMatchObject({ status: "paid", payment_collection: "store", service_fee_cents: 0, commission_cents: 0 });
    expect(order.store_amount_cents).toBe(order.total_cents);
    expect(order.paid_at).not.toBeNull();
    expect((await sql`select count(*)::int as n from payments where order_id = ${orderId}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from ledger_entries where order_id = ${orderId}`)[0].n).toBe(0);
    // A loja foi avisada do pedido novo.
    expect((await sql`select count(*)::int as n from notifications where order_id = ${orderId} and type = 'order_new'`)[0].n).toBeGreaterThan(0);
  });

  it("cancelado antes de ser concluído não gera taxa nem reembolso pelo app", async () => {
    const orderId = await place();
    await appSql.begin((tx) => transitionOrder(tx, { orderId, to: "cancelled", actor: "customer", actorId: customer.id, at: AT, reason: "Desisti" }));
    expect(await feesOf(orderId)).toEqual([]);
    expect((await sql`select count(*)::int as n from refunds where order_id = ${orderId}`)[0].n).toBe(0);
  });
});

describe("taxa por pedido", () => {
  it("um pedido concluído gera exatamente uma taxa de 50 centavos, mesmo reprocessando ao mesmo tempo", async () => {
    const orderId = await place();
    expect(await feesOf(orderId)).toEqual([]); // em andamento não gera nada
    await complete(orderId, at("2026-10-09T16:00:00"));

    const [order] = await sql<{ id: string; store_id: string; discount_cents: number; discount_paid_by: "platform" | "store" | null }[]>`
      select id, store_id, discount_cents, discount_paid_by from orders where id = ${orderId}`;
    // A conclusão chega de novo, duas vezes ao mesmo tempo (aviso repetido, clique duplo...).
    await Promise.all([
      appSql.begin((tx) => recordCompletedOrderFees(tx, order, at("2026-10-09T16:00:00"))),
      appSql.begin((tx) => recordCompletedOrderFees(tx, order, at("2026-10-09T16:00:00"))),
    ]);
    const fees = await feesOf(orderId);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ kind: "order_fee", amount_cents: 50, business_date: "2026-10-09" });
  });

  it("um pedido concluído de madrugada conta para o expediente da noite anterior", async () => {
    const orderId = await place();
    await complete(orderId, at("2026-10-10T01:30:00"));
    expect((await feesOf(orderId))[0].business_date).toBe("2026-10-09");
  });

  it("reembolso depois de concluído estorna a taxa com um lançamento ligado ao original", async () => {
    const orderId = await place();
    await complete(orderId, at("2026-10-09T17:00:00"));
    await appSql.begin((tx) => transitionOrder(tx, { orderId, to: "refunded", actor: "admin", actorId: null, at: at("2026-10-09T18:00:00"), reason: "Loja devolveu o dinheiro" }));
    const [fee, reversal] = await feesOf(orderId);
    expect(reversal).toMatchObject({ kind: "order_fee_reversal", amount_cents: -50, reverses_id: fee.id });
  });
});

describe("fechamento do expediente", () => {
  it("soma tudo o que está aberto, é idempotente e não duplica com dois cliques ao mesmo tempo", async () => {
    const orderId = await place();
    await complete(orderId, at("2026-10-09T19:00:00"));
    const expected = await openNet();
    expect(expected).toBeGreaterThan(0);

    const close = () => closeBusinessDay({ storeId: market.id, businessDate: "2026-10-09", at: at("2026-10-09T23:00:00"), closedBy: market.owner_id });
    const [first, second] = await Promise.all([close(), close()]);
    if (!first.closing || !second.closing) throw new Error("O fechamento não foi criado.");
    expect(first.closing.id).toBe(second.closing.id);
    expect([first, second].filter((result) => "created" in result && result.created)).toHaveLength(1);
    expect(first.closing).toMatchObject({ total_due_cents: expected, status: "awaiting_payment", fee_unit_cents: 50, due_date: "2026-10-12" });
    expect((await sql`select count(*)::int as n from store_closings where store_id = ${market.id} and business_date = '2026-10-09'`)[0].n).toBe(1);
    expect(await openNet()).toBe(0);

    // Recarregar a página e fechar de novo devolve o mesmo fechamento.
    const again = await close();
    expect(again.closing?.id).toBe(first.closing.id);
  });

  it("Pix: reaproveita a cobrança, pendente não conta como recebido e o webhook dá baixa uma vez só", async () => {
    const [closing] = await sql<{ id: string; total_due_cents: number }[]>`
      select id, total_due_cents from store_closings where store_id = ${market.id} and business_date = '2026-10-09'`;
    const first = await requestFeeCharge({ closingId: closing.id, storeId: market.id, at: at("2026-10-10T08:00:00") });
    const second = await requestFeeCharge({ closingId: closing.id, storeId: market.id, at: at("2026-10-10T08:05:00") });
    if (!first.ok || !second.ok) throw new Error("A cobrança não foi gerada.");
    expect(second.charge.id).toBe(first.charge.id);
    expect(second.reused).toBe(true);
    expect(first.charge.amount_cents).toBe(closing.total_due_cents);
    expect((await sql`select count(*)::int as n from fee_payments`)[0].n).toBe(0);

    const paid = buildMockFeeWebhook({ type: "charge.paid", providerChargeId: first.charge.provider_charge_id, amountCents: first.charge.amount_cents, transactionId: "E2E-TX-1" });
    expect(await handleFeeWebhook(paid.rawBody, "assinatura-falsa", at("2026-10-10T08:10:00"))).toBe("invalid_signature");
    expect(await handleFeeWebhook(paid.rawBody, paid.signature, at("2026-10-10T08:10:00"))).toBe("processed");
    expect(await handleFeeWebhook(paid.rawBody, paid.signature, at("2026-10-10T08:11:00"))).toBe("duplicate");
    // A mesma transação Pix num evento novo também não paga duas vezes.
    const resent = buildMockFeeWebhook({ type: "charge.paid", providerChargeId: first.charge.provider_charge_id, amountCents: first.charge.amount_cents, transactionId: "E2E-TX-1" });
    expect(await handleFeeWebhook(resent.rawBody, resent.signature, at("2026-10-10T08:12:00"))).toBe("duplicate");

    const [after] = await sql<{ status: string; paid_at: Date | null }[]>`select status, paid_at from store_closings where id = ${closing.id}`;
    expect(after.status).toBe("paid");
    expect(after.paid_at).not.toBeNull();
    const payments = await sql<{ amount_cents: number; applied: boolean }[]>`select amount_cents, applied from fee_payments`;
    expect(payments).toEqual([{ amount_cents: closing.total_due_cents, applied: true }]);
  });

  it("valor pago diferente não quita: o fechamento vai para análise", async () => {
    const orderId = await place();
    await complete(orderId, at("2026-10-10T12:00:00"));
    const result = await closeBusinessDay({ storeId: market.id, businessDate: "2026-10-10", at: at("2026-10-10T23:00:00"), closedBy: null });
    if (!result.closing) throw new Error(result.reason);
    const charge = await requestFeeCharge({ closingId: result.closing.id, storeId: market.id, at: at("2026-10-11T08:00:00") });
    if (!charge.ok) throw new Error(charge.error);

    const short = buildMockFeeWebhook({ type: "charge.paid", providerChargeId: charge.charge.provider_charge_id, amountCents: charge.charge.amount_cents - 1 });
    expect(await handleFeeWebhook(short.rawBody, short.signature, at("2026-10-11T08:10:00"))).toBe("in_review");
    const [closing] = await sql<{ status: string; review_reason: string | null }[]>`select status, review_reason from store_closings where id = ${result.closing.id}`;
    expect(closing.status).toBe("in_review");
    expect(closing.review_reason).toContain("diferente do cobrado");
    expect((await sql`select applied from fee_payments where charge_id = ${charge.charge.id}`)[0].applied).toBe(false);
  });

  it("cobrança expirada é trocada por outra do mesmo valor, sem dobrar a dívida", async () => {
    const orderId = await place();
    await complete(orderId, at("2026-10-11T12:00:00"));
    const result = await closeBusinessDay({ storeId: market.id, businessDate: "2026-10-11", at: at("2026-10-11T23:00:00"), closedBy: null });
    if (!result.closing) throw new Error(result.reason);
    const first = await requestFeeCharge({ closingId: result.closing.id, storeId: market.id, at: at("2026-10-12T08:00:00") });
    // Dois dias depois o Pix (válido por 24 h) venceu.
    const second = await requestFeeCharge({ closingId: result.closing.id, storeId: market.id, at: at("2026-10-14T08:00:00") });
    if (!first.ok || !second.ok) throw new Error("A cobrança não foi gerada.");
    expect(second.charge.id).not.toBe(first.charge.id);
    expect(second.charge.amount_cents).toBe(first.charge.amount_cents);
    const charges = await sql<{ status: string }[]>`select status from fee_charges where closing_id = ${result.closing.id} order by created_at`;
    expect(charges.map((charge) => charge.status)).toEqual(["expired", "pending"]);
    expect((await sql`select total_due_cents from store_closings where id = ${result.closing.id}`)[0].total_due_cents).toBe(result.closing.total_due_cents);
  });

  it("sem provedor Pix configurado a cobrança fica indisponível e nada se perde", async () => {
    const [closing] = await sql<{ id: string; status: string; total_due_cents: number }[]>`
      select id, status, total_due_cents from store_closings where store_id = ${market.id} and business_date = '2026-10-11'`;
    const before = (await sql`select count(*)::int as n from fee_entries where closing_id = ${closing.id}`)[0].n;
    process.env.FEE_PIX_PROVIDER = "nenhum";
    try {
      const result = await requestFeeCharge({ closingId: closing.id, storeId: market.id, at: at("2026-10-14T09:00:00") });
      expect(result).toMatchObject({ ok: false });
    } finally {
      delete process.env.FEE_PIX_PROVIDER;
    }
    const [after] = await sql<{ status: string; total_due_cents: number }[]>`select status, total_due_cents from store_closings where id = ${closing.id}`;
    expect(after).toEqual({ status: closing.status, total_due_cents: closing.total_due_cents });
    expect((await sql`select count(*)::int as n from fee_entries where closing_id = ${closing.id}`)[0].n).toBe(before);
  });

  it("cupom pago pelo Chegô vira crédito da loja; crédito maior que as taxas passa para o próximo fechamento", async () => {
    await sql`
      insert into coupons (code, description, type, value_cents, paid_by, max_uses_per_customer)
      values ('TAXACREDITO', 'Cupom de teste pago pelo Chegô', 'fixed', 2000, 'platform', 10)`;
    const orderId = await place("TAXACREDITO");
    await complete(orderId, at("2026-10-12T12:00:00"));
    const fees = await feesOf(orderId);
    expect(fees.map((fee) => [fee.kind, fee.amount_cents])).toEqual([["order_fee", 50], ["coupon_credit", -2000]]);

    const result = await closeBusinessDay({ storeId: market.id, businessDate: "2026-10-12", at: at("2026-10-12T23:00:00"), closedBy: null });
    if (!result.closing) throw new Error(result.reason);
    expect(result.closing).toMatchObject({ total_due_cents: 0, status: "paid" });
    const [carried] = await sql<{ amount_cents: number; carried_from_closing_id: string | null }[]>`
      select amount_cents, carried_from_closing_id from fee_entries where store_id = ${market.id} and closing_id is null and kind = 'carryover'`;
    expect(carried).toEqual({ amount_cents: -1950, carried_from_closing_id: result.closing.id });
  });

  it("uma loja nunca vê o fechamento nem as taxas de outra", async () => {
    const [other] = await sql<{ owner_id: string }[]>`select owner_id from stores where slug = 'pizzaria-forno-de-barro'`;
    await inRolledBackTransaction(async (tx) => {
      const mine = await asUser(tx, market.owner_id, (sp) => sp`select id from store_closings where store_id = ${market.id}`);
      const theirs = await asUser(tx, other.owner_id, (sp) => sp`select id from store_closings where store_id = ${market.id}`);
      const theirEntries = await asUser(tx, other.owner_id, (sp) => sp`select id from fee_entries where store_id = ${market.id}`);
      expect((mine as unknown[]).length).toBeGreaterThan(0);
      expect(theirs).toEqual([]);
      expect(theirEntries).toEqual([]);
    });
  });
});
