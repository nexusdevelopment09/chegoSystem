import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { asUser, inRolledBackTransaction, sql } from "./helpers";

// `now()` pede ao Next uma requisição em andamento; aqui não há Next rodando.
vi.mock("next/server", () => ({ connection: async () => {} }));

import type { CurrentProfile } from "@/lib/auth/session";
import { placeOrder } from "@/lib/checkout/place-order";
import { sql as appSql } from "@/lib/db";
import { recordMovement, refreshExpiryAlerts, StockError } from "@/lib/inventory/stock";
import { suggestions } from "@/lib/inventory/queries";
import { transitionOrder } from "@/lib/orders/transitions";

// Estoque integrado aos pedidos, pelo mesmo código do app, no banco de teste.

const AT = new Date("2026-10-09T15:00:00-03:00");
let customer: CurrentProfile;
let addressId: string;
let market: { id: string; owner_id: string; min_order_cents: number };
let product: { id: string; price_cents: number };
let quantity: number;
let sold: string; // item ligado ao produto
let flour: string; // insumo da ficha técnica

const balance = async (itemId: string) => Number((await sql<{ q: string }[]>`select quantity::text as q from stock_items where id = ${itemId}`)[0].q);
const movementsOf = (orderId: string) => sql<{ item_id: string; kind: string; quantity: string }[]>`
  select item_id, kind::text, quantity::text from stock_movements where order_id = ${orderId} order by created_at`;

async function place() {
  const placed = await placeOrder({
    storeId: market.id, fulfillment: "delivery", addressId, ageConfirmed: false, missingItemPolicy: "remove", notes: "", paymentMethod: "pix", couponCode: null,
    items: [{ key: "item-1", productId: product.id, quantity, notes: "", picks: [] }],
  }, customer, AT);
  if (!placed.ok) throw new Error(placed.errors.join(" | "));
  return placed.orderId;
}

beforeAll(async () => {
  const [profile] = await sql<{ id: string; full_name: string; phone: string; birth_date: string | null; city_id: string | null }[]>`
    select id, full_name, phone, birth_date::text, city_id from profiles where full_name = 'Diego Alves'`;
  customer = { id: profile.id, fullName: profile.full_name, phone: profile.phone, role: "customer", blocked: false, birthDate: profile.birth_date, cityId: profile.city_id };
  [{ id: addressId }] = await sql<{ id: string }[]>`select id from addresses where profile_id = ${profile.id} and deleted_at is null limit 1`;
  [market] = await sql`select id, owner_id, min_order_cents from stores where slug = 'mercado-boa-compra'`;
  [product] = await sql`
    select p.id, p.price_cents from products p
    where p.store_id = ${market.id} and p.available and p.deleted_at is null and not p.requires_age_check
      and not exists (select 1 from product_option_groups g where g.product_id = p.id)
      and not exists (select 1 from product_availability a where a.product_id = p.id)
      and p.max_per_order is null and p.weight_step_grams is null
    order by p.price_cents desc limit 1`;
  quantity = Math.max(2, Math.ceil(market.min_order_cents / product.price_cents));
  // O produto passa a controlar estoque com 10 × a quantidade do pedido, pelo item ligado.
  await sql`update products set track_stock = true, stock_qty = ${quantity * 10} where id = ${product.id}`;
  [{ id: sold }] = await sql`insert into stock_items (store_id, name, unit, quantity, min_quantity, product_id) values (${market.id}, 'Item vendido', 'un', ${quantity * 10}, ${quantity * 9 + 1}, ${product.id}) returning id`;
  [{ id: flour }] = await sql`insert into stock_items (store_id, name, unit, quantity, min_quantity) values (${market.id}, 'Farinha', 'kg', 1, 0.5) returning id`;
  await sql`insert into recipe_lines (store_id, product_id, item_id, quantity) values (${market.id}, ${product.id}, ${flour}, 0.25)`;
});

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("estoque integrado aos pedidos", () => {
  it("pedido criado baixa o item ligado uma vez; aceito consome a ficha técnica; repetir não duplica", async () => {
    const orderId = await place();
    expect(await balance(sold)).toBe(quantity * 9);
    expect((await sql`select stock_qty from products where id = ${product.id}`)[0].stock_qty).toBe(quantity * 9);

    const accept = () => appSql.begin((tx) => transitionOrder(tx, { orderId, to: "accepted", actor: "staff", actorId: market.owner_id, at: AT }));
    await accept();
    // Farinha: 0,25 kg por unidade × quantidade, mas só há 1 kg: zera e pede conferência (não trava o pedido).
    const used = Math.min(1, 0.25 * quantity);
    expect(await balance(flour)).toBe(Math.round((1 - used) * 1000) / 1000);
    if (0.25 * quantity > 1) {
      expect((await sql`select kind from stock_alerts where item_id = ${flour} and kind = 'conferir' and resolved_at is null`).length).toBe(1);
    }
    // Recalcular de novo (evento repetido) não baixa outra vez.
    await appSql.begin(async (tx) => {
      const { consumeIngredients, recordOrderSales } = await import("@/lib/inventory/stock");
      await recordOrderSales(tx, orderId);
      await consumeIngredients(tx, orderId);
    });
    const kinds = (await movementsOf(orderId)).map((row) => row.kind).sort();
    expect(kinds).toEqual(["producao", "venda"]);
    // O item vendido caiu abaixo do mínimo: alerta de estoque baixo aberto (um só).
    expect((await sql`select count(*)::int as n from stock_alerts where item_id = ${sold} and kind = 'baixo' and resolved_at is null`)[0].n).toBe(1);
  });

  it("pedido recusado devolve exatamente o que baixou", async () => {
    const before = await balance(sold);
    const orderId = await place();
    expect(await balance(sold)).toBe(before - quantity);
    await appSql.begin((tx) => transitionOrder(tx, { orderId, to: "rejected", actor: "staff", actorId: market.owner_id, at: AT, reason: "Teste" }));
    expect(await balance(sold)).toBe(before);
    expect((await movementsOf(orderId)).map((row) => row.kind)).toEqual(["venda", "devolucao"]);
  });

  it("dois pedidos ao mesmo tempo pela última unidade: só um passa", async () => {
    await sql`update products set stock_qty = ${quantity} where id = ${product.id}`;
    const results = await Promise.allSettled([place(), place()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await sql`select stock_qty from products where id = ${product.id}`)[0].stock_qty).toBe(0);
  });

  it("saída manual maior que o saldo é recusada; ajuste e perda exigem motivo", async () => {
    await expect(appSql.begin((tx) => recordMovement(tx, { storeId: market.id, itemId: flour, kind: "perda", quantity: -50, reason: "Teste" }))).rejects.toThrow(StockError);
    await expect(sql`insert into stock_movements (store_id, item_id, kind, quantity, balance_after) values (${market.id}, ${flour}, 'ajuste', 1, 1)`).rejects.toThrow();
    const result = await appSql.begin((tx) => recordMovement(tx, { storeId: market.id, itemId: flour, kind: "compra", quantity: 5, reason: "Compra" }));
    expect(result?.balance).toBeGreaterThanOrEqual(5);
  });

  it("lotes: a venda usa o que vence primeiro e nunca o vencido; vencido gera alerta", async () => {
    const [{ id: milk }] = await sql`insert into stock_items (store_id, name, unit, perishable) values (${market.id}, 'Leite', 'l', true) returning id`;
    await appSql.begin(async (tx) => {
      await recordMovement(tx, { storeId: market.id, itemId: milk, kind: "compra", quantity: 2, newLot: { expiresAt: "2026-10-05", manufacturedAt: null, supplier: null, costCents: null, receivedAt: "2026-09-20" } });
      await recordMovement(tx, { storeId: market.id, itemId: milk, kind: "compra", quantity: 3, newLot: { expiresAt: "2026-10-20", manufacturedAt: null, supplier: null, costCents: null, receivedAt: "2026-10-01" } });
      await recordMovement(tx, { storeId: market.id, itemId: milk, kind: "venda", quantity: -1, process: "teste" });
    });
    const lots = await sql<{ expires_at: string; remaining_quantity: string }[]>`select expires_at::text, remaining_quantity::text from stock_lots where item_id = ${milk} order by expires_at`;
    // O lote vencido (05/10) ficou intacto; saiu do que vence em 20/10.
    expect(lots.map((lot) => [lot.expires_at, Number(lot.remaining_quantity)])).toEqual([["2026-10-05", 2], ["2026-10-20", 2]]);
    await refreshExpiryAlerts(sql, market.id, "2026-10-09");
    const alerts = await sql<{ kind: string }[]>`select kind::text from stock_alerts where item_id = ${milk} and resolved_at is null order by kind`;
    expect(alerts.map((alert) => alert.kind)).toEqual(["vencendo", "vencido"]);
  });

  it("sugestão de reposição usa as saídas registradas", async () => {
    const list = await suggestions(market.id, new Date(Date.now() + 60_000));
    const item = list.find((row) => row.id === sold)!;
    expect(item.out30).toBeGreaterThan(0);
    expect(item.hasRecipe).toBe(true);
  });

  it("pelo navegador ninguém grava estoque, e outra loja não lê", () =>
    inRolledBackTransaction(async (tx) => {
      const [other] = await tx`select owner_id from stores where slug = 'pizzaria-forno-de-barro'`;
      expect(await asUser(tx, other.owner_id, (q) => q`select id from stock_items where store_id = ${market.id}`)).toHaveLength(0);
      await expect(asUser(tx, market.owner_id, (q) => q`update stock_items set quantity = 999 where id = ${sold}`)).rejects.toThrow(/permission denied/);
      await expect(asUser(tx, market.owner_id, (q) => q`delete from stock_movements`)).rejects.toThrow(/permission denied/);
      expect(await asUser(tx, market.owner_id, (q) => q`select id from stock_items where id = ${sold}`)).toHaveLength(1);
    }));
});
