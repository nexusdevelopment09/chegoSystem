import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { asUser, inRolledBackTransaction, sql } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { sql as appSql } from "@/lib/db";
import { addBillItem, addBillPayment, BillError, cancelBillItem, closeBill, openBill } from "@/lib/tables/bills";

// Mesas e balcão pelo mesmo código do app, no banco de teste.

const AT = new Date("2026-10-09T20:00:00-03:00");
let actor: { profileId: string; role: string; storeId: string };
let tableId: string;
let product: { id: string; price_cents: number };
let itemId: string;

beforeAll(async () => {
  const [store] = await sql`select id, owner_id from stores where slug = 'pizzaria-forno-de-barro'`;
  actor = { profileId: store.owner_id, role: "owner", storeId: store.id };
  [{ id: tableId }] = await sql`insert into store_tables (store_id, label) values (${store.id}, '7') returning id`;
  // Um produto sem escolhas obrigatórias, com estoque controlado e um item de estoque ligado.
  [product] = await sql`
    select p.id, p.price_cents from products p where p.store_id = ${store.id} and p.deleted_at is null and p.available
      and not exists (select 1 from product_option_groups g where g.product_id = p.id and (g.required or g.min_choices > 0))
      and not exists (select 1 from product_availability a where a.product_id = p.id)
    order by p.price_cents desc limit 1`;
  await sql`update products set track_stock = true, stock_qty = 5 where id = ${product.id}`;
  [{ id: itemId }] = await sql`insert into stock_items (store_id, name, unit, quantity, product_id) values (${store.id}, 'Vendido na mesa', 'un', 5, ${product.id}) returning id`;
});

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("mesas e balcão", () => {
  it("conta completa: itens, estoque, pagamento parcial, fechamento vira um pedido e uma taxa", async () => {
    const billId = await appSql.begin((tx) => openBill(tx, actor, { tableId, customerName: null }));
    // A mesma mesa não abre duas contas.
    await expect(appSql.begin((tx) => openBill(tx, actor, { tableId, customerName: null }))).rejects.toThrow(BillError);

    await appSql.begin((tx) => addBillItem(tx, actor, { billId, productId: product.id, quantity: 2, notes: "sem gelo", picks: [], at: AT }));
    const extra = await appSql.begin((tx) => addBillItem(tx, actor, { billId, productId: product.id, quantity: 1, notes: null, picks: [], at: AT }));
    expect((await sql`select stock_qty from products where id = ${product.id}`)[0].stock_qty).toBe(2);
    // Não vende o que não tem.
    await expect(appSql.begin((tx) => addBillItem(tx, actor, { billId, productId: product.id, quantity: 3, notes: null, picks: [], at: AT }))).rejects.toThrow(/estoque/);
    // Cancelar o item devolve o estoque.
    await appSql.begin((tx) => cancelBillItem(tx, actor, { itemId: extra, reason: "Pediu errado" }));
    expect((await sql`select stock_qty from products where id = ${product.id}`)[0].stock_qty).toBe(3);
    expect(Number((await sql`select quantity from stock_items where id = ${itemId}`)[0].quantity)).toBe(3);

    const total = product.price_cents * 2;
    await appSql.begin((tx) => addBillPayment(tx, actor, { billId, method: "pix", amountCents: Math.floor(total / 2) }));
    await expect(appSql.begin((tx) => closeBill(tx, actor, { billId, at: AT }))).rejects.toThrow(/falta receber/);
    await expect(appSql.begin((tx) => addBillPayment(tx, actor, { billId, method: "card", amountCents: total }))).rejects.toThrow(/no máximo/);
    await appSql.begin((tx) => addBillPayment(tx, actor, { billId, method: "cash", amountCents: total }));

    // Dois cliques em "Fechar" ao mesmo tempo: um fecha, o outro é recusado.
    const results = await Promise.allSettled([appSql.begin((tx) => closeBill(tx, actor, { billId, at: AT })), appSql.begin((tx) => closeBill(tx, actor, { billId, at: AT }))]);
    const closed = results.filter((result) => result.status === "fulfilled");
    expect(closed).toHaveLength(1);
    const { orderId, changeCents } = (closed[0] as PromiseFulfilledResult<{ orderId: string; changeCents: number }>).value;
    expect(changeCents).toBe(Math.ceil(total / 2));

    const [order] = await sql`select channel, status, total_cents, customer_id, payment_collection from orders where id = ${orderId}`;
    expect(order).toEqual({ channel: "mesa", status: "picked_up", total_cents: total, customer_id: null, payment_collection: "store" });
    expect((await sql`select sum(quantity)::int as q from order_items where order_id = ${orderId}`)[0].q).toBe(2);
    // Taxa do Chegô: uma, de R$ 0,50 (a regra também vale para vendas na loja).
    expect((await sql`select amount_cents from fee_entries where order_id = ${orderId} and kind = 'order_fee'`).map((row) => row.amount_cents)).toEqual([50]);
    // O estoque baixou item a item (2 vendidos; o cancelado voltou) e nada baixou de novo no fechamento.
    const moves = await sql`
      select m.kind::text, m.quantity::text from stock_movements m join table_bill_items i on i.id = m.bill_item_id where i.bill_id = ${billId} order by m.created_at`;
    expect(moves.map((row) => [row.kind, Number(row.quantity)])).toEqual([["venda", -2], ["venda", -1], ["devolucao", 1]]);
    expect(Number((await sql`select quantity from stock_items where id = ${itemId}`)[0].quantity)).toBe(3);
    expect((await sql`select status, order_id from table_bills where id = ${billId}`)[0]).toEqual({ status: "fechada", order_id: orderId });
    // Auditoria de abrir, itens, pagamentos e fechamento.
    const actions = (await sql`select action from audit_logs where entity_id = ${billId} order by created_at`).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["mesas.conta_aberta", "mesas.item_adicionado", "mesas.item_cancelado", "mesas.pagamento", "mesas.conta_fechada"]));
    // A mesa está livre de novo.
    const again = await appSql.begin((tx) => openBill(tx, actor, { tableId, customerName: "João" }));
    expect(again).not.toBe(billId);
  });

  it("outra loja não lê as contas, e pelo navegador ninguém grava", () =>
    inRolledBackTransaction(async (tx) => {
      const [other] = await tx`select owner_id from stores where slug = 'brasa-burger'`;
      expect(await asUser(tx, other.owner_id, (q) => q`select id from table_bills where store_id = ${actor.storeId}`)).toHaveLength(0);
      await expect(asUser(tx, actor.profileId, (q) => q`update table_bills set status = 'fechada'`)).rejects.toThrow(/permission denied/);
      await expect(asUser(tx, actor.profileId, (q) => q`insert into table_bill_payments (bill_id, method, amount_cents, received_by) select id, 'cash', 1, ${actor.profileId} from table_bills limit 1`)).rejects.toThrow(/permission denied/);
    }));
});
