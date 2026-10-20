import "server-only";
import type postgres from "postgres";
import { audit } from "@/lib/audit";
import { productStatus } from "@/lib/catalog/availability";
import { loadProducts } from "@/lib/catalog/queries";
import { describeOptions, resolveSelection, toSnapshot, type Pick } from "@/lib/catalog/selection";
import { recordCompletedOrderFees } from "@/lib/fees/ledger";
import { consumeIngredients, recordMovement } from "@/lib/inventory/stock";
import { soldAmount, type StockUnit } from "@/lib/inventory/rules";
import { billTotals, closeProblem, mainMethod, paymentProblem, type BillItem, type BillPayment } from "./rules";

// Contas de mesa e de balcão. Usam os mesmos produtos, preços, opções e estoque do app.
// Ao fechar, a conta vira UM pedido do canal "mesa" ou "balcao", já concluído: é ele que entra
// nos relatórios, nos mais vendidos e na taxa do Chegô, uma vez só (a conta guarda o order_id).

type Tx = postgres.TransactionSql;
type Actor = { profileId: string; role: string; storeId: string };

export class BillError extends Error {}

async function lockOpenBill(tx: Tx, billId: string, storeId: string) {
  const [bill] = await tx<{ id: string; table_id: string | null; label: string; customer_name: string | null; status: string }[]>`
    select id, table_id, label, customer_name, status from table_bills where id = ${billId} and store_id = ${storeId} for update`;
  if (!bill) throw new BillError("Conta não encontrada.");
  if (bill.status !== "aberta") throw new BillError("Esta conta já foi fechada ou cancelada.");
  return bill;
}

async function totalsOf(tx: Tx, billId: string) {
  const items = await tx<{ unit_price_cents: number; quantity: number; cancelled_at: Date | null }[]>`select unit_price_cents, quantity, cancelled_at from table_bill_items where bill_id = ${billId}`;
  const payments = await tx<{ method: BillPayment["method"]; amount_cents: number; cancelled_at: Date | null }[]>`select method, amount_cents, cancelled_at from table_bill_payments where bill_id = ${billId}`;
  const billItems: BillItem[] = items.map((item) => ({ unitPriceCents: item.unit_price_cents, quantity: item.quantity, cancelled: item.cancelled_at !== null }));
  const billPayments: BillPayment[] = payments.map((payment) => ({ method: payment.method, amountCents: payment.amount_cents, cancelled: payment.cancelled_at !== null }));
  return { totals: billTotals(billItems, billPayments), payments: billPayments };
}

/** Abre uma conta (numa mesa livre) ou uma venda de balcão (sem mesa). */
export async function openBill(tx: Tx, actor: Actor, input: { tableId: string | null; customerName: string | null; at?: Date }) {
  let label = "Balcão";
  if (input.tableId) {
    const [table] = await tx<{ label: string }[]>`select label from store_tables where id = ${input.tableId} and store_id = ${actor.storeId} and active for update`;
    if (!table) throw new BillError("Mesa não encontrada ou desativada.");
    const [busy] = await tx`select 1 from table_bills where table_id = ${input.tableId} and status = 'aberta'`;
    if (busy) throw new BillError(`A mesa ${table.label} já tem uma conta aberta.`);
    label = `Mesa ${table.label}`;
  }
  const [bill] = await tx<{ id: string }[]>`
    insert into table_bills (store_id, table_id, label, customer_name, opened_by, opened_at)
    values (${actor.storeId}, ${input.tableId}, ${label}, ${input.customerName}, ${actor.profileId}, coalesce(${input.at ?? null}::timestamptz, now()))
    returning id`;
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.conta_aberta", module: "mesas", entityType: "table_bill", entityId: bill.id, storeId: actor.storeId, details: { conta: label } }, tx);
  return bill.id;
}

/**
 * Item na conta: preço e escolhas conferidos pelo mesmo motor do app; o estoque do produto é
 * reservado na hora (não deixa vender o que acabou) e baixa no controle de estoque.
 */
export async function addBillItem(tx: Tx, actor: Actor, input: { billId: string; productId: string; quantity: number; notes: string | null; picks: Pick[]; at: Date }) {
  await lockOpenBill(tx, input.billId, actor.storeId);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw new BillError("Quantidade inválida.");
  const product = (await loadProducts([input.productId])).get(input.productId);
  if (!product || product.storeId !== actor.storeId) throw new BillError("Produto não encontrado.");
  if (product.weightStepGrams) throw new BillError("Produto vendido por peso: registre pelo pedido do app ou cadastre uma porção fixa.");
  const status = productStatus(product.rules, input.at);
  if (!status.orderable && status.reason === "sold_out") throw new BillError(`${product.name} está esgotado.`);
  if (product.maxPerOrder && input.quantity > product.maxPerOrder) throw new BillError(`No máximo ${product.maxPerOrder} por conta.`);
  const selection = resolveSelection(product.priceCents, product.groups, input.picks);
  if (!selection.ok) throw new BillError(selection.error);

  const reserved = await tx`
    update products set stock_qty = case when track_stock then stock_qty - ${input.quantity} else stock_qty end
    where id = ${product.id} and (not track_stock or stock_qty >= ${input.quantity}) returning id`;
  if (reserved.length === 0) throw new BillError(`Não há estoque suficiente de ${product.name}.`);

  const snapshot = toSnapshot(selection.groups);
  const [item] = await tx<{ id: string }[]>`
    insert into table_bill_items (bill_id, product_id, name, unit_price_cents, quantity, notes, added_by, options, lines)
    values (${input.billId}, ${product.id}, ${product.name}, ${selection.unitPriceCents}, ${input.quantity}, ${input.notes}, ${actor.profileId},
            ${tx.json(snapshot as never)}, ${describeOptions(snapshot)})
    returning id`;
  const [linked] = await tx<{ id: string; unit: StockUnit }[]>`select id, unit from stock_items where product_id = ${product.id} and store_id = ${actor.storeId} and status <> 'inativo'`;
  if (linked) {
    await recordMovement(tx, { storeId: actor.storeId, itemId: linked.id, kind: "venda", quantity: -soldAmount(input.quantity, null, linked.unit), billItemId: item.id, process: "conta de mesa", createdBy: actor.profileId, syncProduct: false, estimate: true });
  }
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.item_adicionado", module: "mesas", entityType: "table_bill", entityId: input.billId, storeId: actor.storeId, details: { produto: product.name, quantidade: input.quantity, preco: selection.unitPriceCents } }, tx);
  return item.id;
}

/** Tira um item da conta (com motivo): o estoque volta. */
export async function cancelBillItem(tx: Tx, actor: Actor, input: { itemId: string; reason: string }) {
  const [item] = await tx<{ bill_id: string; product_id: string | null; quantity: number; name: string; cancelled_at: Date | null }[]>`
    select i.bill_id, i.product_id, i.quantity, i.name, i.cancelled_at from table_bill_items i join table_bills b on b.id = i.bill_id
    where i.id = ${input.itemId} and b.store_id = ${actor.storeId} for update of i`;
  if (!item || item.cancelled_at) throw new BillError("Item não encontrado ou já cancelado.");
  await lockOpenBill(tx, item.bill_id, actor.storeId);
  await tx`update table_bill_items set cancelled_at = now(), cancelled_by = ${actor.profileId}, cancel_reason = ${input.reason} where id = ${input.itemId}`;
  if (item.product_id) await tx`update products set stock_qty = stock_qty + ${item.quantity} where id = ${item.product_id} and track_stock`;
  const sales = await tx<{ item_id: string; quantity: string }[]>`select item_id, quantity::text from stock_movements where bill_item_id = ${input.itemId} and kind = 'venda'`;
  for (const sale of sales) {
    await recordMovement(tx, { storeId: actor.storeId, itemId: sale.item_id, kind: "devolucao", quantity: -Number(sale.quantity), billItemId: input.itemId, process: "item cancelado na mesa", createdBy: actor.profileId, syncProduct: false });
  }
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.item_cancelado", module: "mesas", entityType: "table_bill", entityId: item.bill_id, storeId: actor.storeId, reason: input.reason, details: { produto: item.name, quantidade: item.quantity } }, tx);
}

export async function addBillPayment(tx: Tx, actor: Actor, input: { billId: string; method: BillPayment["method"]; amountCents: number }) {
  await lockOpenBill(tx, input.billId, actor.storeId);
  const { totals } = await totalsOf(tx, input.billId);
  const problem = paymentProblem(totals, input.method, input.amountCents);
  if (problem) throw new BillError(problem);
  const [payment] = await tx<{ id: string }[]>`
    insert into table_bill_payments (bill_id, method, amount_cents, received_by) values (${input.billId}, ${input.method}, ${input.amountCents}, ${actor.profileId}) returning id`;
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.pagamento", module: "mesas", entityType: "table_bill", entityId: input.billId, storeId: actor.storeId, details: { forma: input.method, valor: input.amountCents } }, tx);
  return payment.id;
}

export async function cancelBillPayment(tx: Tx, actor: Actor, input: { paymentId: string; reason: string }) {
  const [payment] = await tx<{ bill_id: string; amount_cents: number; method: string; cancelled_at: Date | null }[]>`
    select p.bill_id, p.amount_cents, p.method, p.cancelled_at from table_bill_payments p join table_bills b on b.id = p.bill_id
    where p.id = ${input.paymentId} and b.store_id = ${actor.storeId} for update of p`;
  if (!payment || payment.cancelled_at) throw new BillError("Pagamento não encontrado ou já cancelado.");
  await lockOpenBill(tx, payment.bill_id, actor.storeId);
  await tx`update table_bill_payments set cancelled_at = now(), cancelled_by = ${actor.profileId}, cancel_reason = ${input.reason} where id = ${input.paymentId}`;
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.pagamento_cancelado", module: "mesas", entityType: "table_bill", entityId: payment.bill_id, storeId: actor.storeId, reason: input.reason, details: { forma: payment.method, valor: payment.amount_cents } }, tx);
}

/**
 * Fecha a conta: só paga (troco só em dinheiro). Cria o pedido concluído do canal mesa/balcão
 * com os itens e as opções, liga as baixas de estoque a ele, consome a ficha técnica e lança a
 * taxa do Chegô. A conta fica travada; fechar de novo não faz nada.
 */
export async function closeBill(tx: Tx, actor: Actor, input: { billId: string; at: Date }) {
  const bill = await lockOpenBill(tx, input.billId, actor.storeId);
  const { totals, payments } = await totalsOf(tx, input.billId);
  const problem = closeProblem(totals);
  if (problem) throw new BillError(problem);

  const [city] = await tx<{ id: string; prefix: string; number: number }[]>`
    update cities set next_order_number = next_order_number + 1 where id = (select city_id from stores where id = ${actor.storeId})
    returning id, order_code_prefix as prefix, next_order_number - 1 as number`;
  const code = `${city.prefix}-${String(city.number).padStart(4, "0")}`;
  const channel = bill.table_id ? "mesa" : "balcao";
  const [order] = await tx<{ id: string }[]>`
    insert into orders (code, city_id, customer_id, store_id, status, fulfillment, customer_name, subtotal_cents, discount_cents, delivery_fee_cents,
                        service_fee_cents, commission_rate, commission_cents, store_amount_cents, platform_amount_cents, total_cents, payment_method,
                        payment_collection, channel, paid_at, accepted_at, ready_at, completed_at, created_at, updated_at)
    values (${code}, ${city.id}, null, ${actor.storeId}, 'picked_up', 'pickup', ${bill.customer_name ? `${bill.label} · ${bill.customer_name}` : bill.label},
            ${totals.totalCents}, 0, 0, 0, 0, 0, ${totals.totalCents}, 0, ${totals.totalCents}, ${mainMethod(payments)},
            'store', ${channel}, ${input.at}, ${input.at}, ${input.at}, ${input.at}, ${input.at}, ${input.at})
    returning id`;
  const items = await tx<{ id: string; product_id: string | null; name: string; unit_price_cents: number; quantity: number; notes: string | null; options: { optionId: string; groupName: string; optionName: string; mode: string; quantity: number; priceCents: number }[] }[]>`
    select id, product_id, name, unit_price_cents, quantity, notes, options from table_bill_items where bill_id = ${input.billId} and cancelled_at is null order by added_at`;
  for (const item of items) {
    const [orderItem] = await tx<{ id: string }[]>`
      insert into order_items (order_id, product_id, name, unit_price_cents, quantity, line_total_cents, notes)
      values (${order.id}, ${item.product_id}, ${item.name}, ${item.unit_price_cents}, ${item.quantity}, ${item.unit_price_cents * item.quantity}, ${item.notes})
      returning id`;
    for (const [index, option] of item.options.entries()) {
      await tx`
        insert into order_item_options (order_item_id, option_id, group_name, option_name, price_mode, quantity, price_cents, sort_order)
        values (${orderItem.id}, ${option.optionId}, ${option.groupName}, ${option.optionName}, ${option.mode}::option_price_mode, ${option.quantity}, ${option.priceCents}, ${index})`;
    }
  }
  await tx`
    insert into order_status_history (order_id, status, changed_by, created_at) values
      (${order.id}, 'paid', ${actor.profileId}, ${input.at}), (${order.id}, 'picked_up', ${actor.profileId}, ${input.at})`;
  // As baixas feitas item a item continuam ligadas aos itens da conta (que aponta para o pedido):
  // relatórios e balancete chegam a elas pela conta, sem regravar nada.
  await consumeIngredients(tx, order.id, "fechamento de conta");
  await recordCompletedOrderFees(tx, { id: order.id, store_id: actor.storeId, discount_cents: 0, discount_paid_by: null }, input.at);
  await tx`update table_bills set status = 'fechada', closed_by = ${actor.profileId}, closed_at = ${input.at}, order_id = ${order.id} where id = ${input.billId}`;
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.conta_fechada", module: "mesas", entityType: "table_bill", entityId: input.billId, storeId: actor.storeId, details: { conta: bill.label, pedido: code, total: totals.totalCents, troco: totals.changeCents } }, tx);
  return { orderId: order.id, code, changeCents: totals.changeCents };
}

/** Cancela uma conta aberta sem nenhum item ativo nem pagamento (aberta por engano). */
export async function cancelBill(tx: Tx, actor: Actor, input: { billId: string; reason: string }) {
  await lockOpenBill(tx, input.billId, actor.storeId);
  const { totals } = await totalsOf(tx, input.billId);
  if (totals.totalCents > 0 || totals.paidCents > 0) throw new BillError("Cancele os itens e os pagamentos antes de cancelar a conta.");
  await tx`update table_bills set status = 'cancelada', closed_by = ${actor.profileId}, closed_at = now(), cancel_reason = ${input.reason} where id = ${input.billId}`;
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: "mesas.conta_cancelada", module: "mesas", entityType: "table_bill", entityId: input.billId, storeId: actor.storeId, reason: input.reason }, tx);
}
