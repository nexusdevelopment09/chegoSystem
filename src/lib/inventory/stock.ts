import "server-only";
import type postgres from "postgres";
import { audit } from "@/lib/audit";
import { now } from "@/lib/clock";
import { toLocal } from "@/lib/time";
import { estimateConsumption, soldAmount, stockLevel, type MovementKind, type RecipeLine, type SoldLine, type StockUnit } from "./rules";

// Estoque da loja. TODA mudança de saldo passa por recordMovement: trava a linha do item,
// grava a movimentação com o saldo depois dela, mexe nos lotes e atualiza os alertas, na
// mesma transação. Nada de editar a quantidade "na mão": correção é um ajuste rastreável.

type Tx = postgres.TransactionSql;

export class StockError extends Error {}

export type MovementInput = {
  storeId: string;
  itemId: string;
  kind: MovementKind;
  /** Com sinal: positivo entra, negativo sai. */
  quantity: number;
  reason?: string | null;
  lotId?: string | null;
  orderId?: string | null;
  billItemId?: string | null;
  createdBy?: string | null;
  process?: string | null;
  /** Quando aconteceu (relógio do app). Decide o que já venceu; o padrão é agora. */
  at?: Date;
  /** Entrada com lote (compra de perecível). */
  newLot?: { expiresAt: string | null; manufacturedAt: string | null; supplier: string | null; costCents: number | null; receivedAt: string };
  /**
   * Item ligado a um produto do cardápio: acompanha o estoque do produto. Falso quando o
   * pedido já mexeu no estoque do produto (a reserva do checkout).
   */
  syncProduct?: boolean;
  /** Saídas estimadas (consumo da ficha técnica): param no zero em vez de recusar. */
  estimate?: boolean;
};

type ItemRow = { id: string; store_id: string; quantity: string; min_quantity: string; unit: StockUnit; product_id: string | null; name: string };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Registra uma movimentação. Devolve null quando ela já existia (mesmo pedido, item e tipo). */
export async function recordMovement(tx: Tx, input: MovementInput): Promise<{ id: string; balance: number } | null> {
  const [item] = await tx<ItemRow[]>`
    select id, store_id, quantity::text, min_quantity::text, unit, product_id, name from stock_items
    where id = ${input.itemId} and store_id = ${input.storeId} for update`;
  if (!item) throw new StockError("Item de estoque não encontrado nesta loja.");
  const [settings] = await tx<{ allow_negative: boolean }[]>`select allow_negative from store_stock_settings where store_id = ${input.storeId}`;
  const allowNegative = settings?.allow_negative ?? false;

  // Evento repetido (o mesmo pedido de novo): nada muda.
  if (input.orderId || input.billItemId) {
    const [existing] = await tx`
      select id from stock_movements where item_id = ${item.id} and kind = ${input.kind}
        and ${input.orderId ? tx`order_id = ${input.orderId}` : tx`bill_item_id = ${input.billItemId!}`}`;
    if (existing) return null;
  }

  const current = Number(item.quantity);
  let quantity = round(input.quantity);
  let shortage = 0;
  if (quantity < 0 && current + quantity < 0 && !allowNegative) {
    if (!input.estimate) throw new StockError(`Estoque insuficiente de ${item.name}: há ${current.toLocaleString("pt-BR")} e a saída é de ${(-quantity).toLocaleString("pt-BR")}.`);
    // Consumo estimado maior que o saldo: zera e pede conferência, sem travar o pedido.
    shortage = round(-(current + quantity));
    quantity = round(-Math.max(current, 0));
  }
  if (quantity === 0) {
    if (shortage > 0) await openAlert(tx, item, "conferir", null, `Consumo estimado passou do estoque em ${shortage.toLocaleString("pt-BR")}. Confira o inventário.`);
    return null;
  }
  const balance = round(current + quantity);

  let lotId = input.lotId ?? null;
  if (input.newLot && quantity > 0) {
    const [lot] = await tx<{ id: string }[]>`
      insert into stock_lots (store_id, item_id, received_quantity, remaining_quantity, received_at, manufactured_at, expires_at, supplier, cost_cents)
      values (${input.storeId}, ${item.id}, ${quantity}, ${quantity}, ${input.newLot.receivedAt}, ${input.newLot.manufacturedAt}, ${input.newLot.expiresAt},
              ${input.newLot.supplier}, ${input.newLot.costCents})
      returning id`;
    lotId = lot.id;
  } else if (quantity < 0) {
    await takeFromLots(tx, item.id, -quantity, lotId, input.kind, toLocal(input.at ?? (await now())).date);
  } else if (lotId && quantity > 0) {
    await tx`update stock_lots set remaining_quantity = remaining_quantity + ${quantity} where id = ${lotId} and item_id = ${item.id}`;
  }

  const [movement] = await tx<{ id: string }[]>`
    insert into stock_movements (store_id, item_id, lot_id, kind, quantity, balance_after, reason, order_id, bill_item_id, created_by, process)
    values (${input.storeId}, ${item.id}, ${lotId}, ${input.kind}, ${quantity}, ${balance}, ${input.reason ?? null}, ${input.orderId ?? null},
            ${input.billItemId ?? null}, ${input.createdBy ?? null}, ${input.process ?? null})
    returning id`;
  await tx`
    update stock_items set quantity = ${balance}, last_movement_at = now(), updated_at = now()
      ${input.kind === "compra" ? tx`, last_purchase_at = now()` : tx``}
    where id = ${item.id}`;
  if (item.product_id && input.syncProduct !== false) {
    await tx`update products set stock_qty = ${Math.max(0, Math.floor(balance))} where id = ${item.product_id} and track_stock`;
  }
  if (shortage > 0) await openAlert(tx, item, "conferir", null, `Consumo estimado passou do estoque em ${shortage.toLocaleString("pt-BR")}. Confira o inventário.`);
  await refreshLevelAlert(tx, { ...item, quantity: String(balance) });
  return { id: movement.id, balance };
}

/** Saída tira dos lotes: o lote escolhido, ou os que vencem primeiro (venda nunca usa lote vencido). */
async function takeFromLots(tx: Tx, itemId: string, amount: number, lotId: string | null, kind: MovementKind, today: string) {
  const lots = await tx<{ id: string; remaining_quantity: string }[]>`
    select id, remaining_quantity::text from stock_lots
    where item_id = ${itemId} and remaining_quantity > 0 and discarded_at is null
      ${lotId ? tx`and id = ${lotId}` : tx``}
      ${kind === "venda" || kind === "producao" ? tx`and (expires_at is null or expires_at >= ${today}::date)` : tx``}
    order by expires_at nulls last, received_at
    for update`;
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, Number(lot.remaining_quantity));
    await tx`update stock_lots set remaining_quantity = remaining_quantity - ${take} where id = ${lot.id}`;
    left = round(left - take);
  }
}

async function openAlert(tx: Tx, item: Pick<ItemRow, "id" | "store_id">, kind: "baixo" | "vencendo" | "vencido" | "conferir", lotId: string | null, detail: string) {
  await tx`
    insert into stock_alerts (store_id, item_id, lot_id, kind, detail) values (${item.store_id}, ${item.id}, ${lotId}, ${kind}, ${detail})
    on conflict (item_id, kind, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null do nothing`;
}

/** Abre o alerta de estoque baixo quando o item cai abaixo do mínimo e resolve quando volta. */
async function refreshLevelAlert(tx: Tx, item: ItemRow) {
  const level = stockLevel(Number(item.quantity), Number(item.min_quantity));
  if (level === "normal") {
    await tx`update stock_alerts set resolved_at = now() where item_id = ${item.id} and kind = 'baixo' and resolved_at is null`;
  } else {
    await openAlert(tx, item, "baixo", null, level === "zerado" ? "Sem estoque" : "Abaixo do estoque mínimo");
  }
}

/** Alertas de validade de toda a loja (rodado ao abrir o estoque e pela tarefa diária). */
export async function refreshExpiryAlerts(tx: Tx | postgres.Sql, storeId: string, today: string) {
  const [settings] = await tx<{ days: number[] }[]>`select expiry_warning_days as days from store_stock_settings where store_id = ${storeId}`;
  const horizon = Math.max(...(settings?.days ?? [30, 15, 7, 3]));
  await tx`
    insert into stock_alerts (store_id, item_id, lot_id, kind, detail)
    select l.store_id, l.item_id, l.id, case when l.expires_at < ${today}::date then 'vencido'::stock_alert_kind else 'vencendo'::stock_alert_kind end,
           'Validade ' || to_char(l.expires_at, 'DD/MM/YYYY')
    from stock_lots l
    where l.store_id = ${storeId} and l.remaining_quantity > 0 and l.discarded_at is null and l.expires_at <= ${today}::date + ${horizon}::int
    on conflict (item_id, kind, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null do nothing`;
  // Lote vencido não está mais "vencendo"; lote zerado ou descartado não alerta mais nada.
  await tx`
    update stock_alerts a set resolved_at = now()
    from stock_lots l
    where a.lot_id = l.id and a.store_id = ${storeId} and a.resolved_at is null
      and (l.remaining_quantity = 0 or l.discarded_at is not null or (a.kind = 'vencendo' and l.expires_at < ${today}::date))`;
}

// ------------------------------------------------------------------ pedidos

/**
 * Pedido criado: baixa dos itens de estoque ligados aos produtos vendidos (o estoque do
 * produto já foi reservado pelo checkout, então syncProduct = false). Idempotente.
 */
export async function recordOrderSales(tx: Tx, orderId: string) {
  const lines = await tx<{ store_id: string; item_id: string; unit: StockUnit; quantity: number; weight_step_grams: number | null }[]>`
    select o.store_id, si.id as item_id, si.unit, sum(i.quantity)::int as quantity, i.weight_step_grams
    from order_items i join orders o on o.id = i.order_id
    join stock_items si on si.product_id = i.product_id and si.store_id = o.store_id and si.status <> 'inativo'
    where i.order_id = ${orderId} and i.removed_at is null
    group by o.store_id, si.id, si.unit, i.weight_step_grams`;
  for (const line of lines) {
    await recordMovement(tx, {
      storeId: line.store_id, itemId: line.item_id, kind: "venda", quantity: -soldAmount(line.quantity, line.weight_step_grams, line.unit),
      orderId, process: "pedido", syncProduct: false, estimate: true,
    });
  }
}

/** Pedido que não vai acontecer (recusado, cancelado, expirado): devolve exatamente o que foi baixado. */
export async function returnOrderSales(tx: Tx, orderId: string) {
  const sales = await tx<{ store_id: string; item_id: string; quantity: string }[]>`
    select store_id, item_id, quantity::text from stock_movements where order_id = ${orderId} and kind = 'venda'`;
  for (const sale of sales) {
    await recordMovement(tx, {
      storeId: sale.store_id, itemId: sale.item_id, kind: "devolucao", quantity: -Number(sale.quantity),
      orderId, process: "pedido cancelado", syncProduct: false,
    });
  }
}

/**
 * Loja aceitou o pedido (vai produzir): consome os insumos pela ficha técnica. É estimativa
 * (não trava o pedido se o saldo não der: zera e pede conferência). Idempotente. Cancelar
 * depois do aceite não devolve insumos (já foram usados); a perda real se registra à parte.
 */
export async function consumeIngredients(tx: Tx, orderId: string, process = "pedido aceito") {
  const [order] = await tx<{ store_id: string }[]>`select store_id from orders where id = ${orderId}`;
  if (!order) return;
  const items = await tx<{ id: string; product_id: string | null; quantity: number }[]>`
    select id, product_id, quantity from order_items where order_id = ${orderId} and removed_at is null and product_id is not null`;
  if (items.length === 0) return;
  const recipe = (await tx<{ product_id: string; option_id: string | null; item_id: string; quantity: string }[]>`
    select product_id, option_id, item_id, quantity::text from recipe_lines
    where store_id = ${order.store_id} and product_id = any(${items.map((item) => item.product_id!)}::uuid[])`)
    .map((row): RecipeLine => ({ productId: row.product_id, optionId: row.option_id, itemId: row.item_id, quantity: Number(row.quantity) }));
  if (recipe.length === 0) return;

  const options = await tx<{ order_item_id: string; option_id: string | null; quantity: number; choices: number; price_mode: string }[]>`
    select o.order_item_id, o.option_id, o.quantity,
           count(*) over (partition by o.order_item_id, o.group_name)::int as choices, o.price_mode
    from order_item_options o where o.order_item_id = any(${items.map((item) => item.id)}::uuid[])`;
  const sold: SoldLine[] = items.map((item) => ({
    productId: item.product_id!, quantity: item.quantity,
    options: options.filter((option) => option.order_item_id === item.id && option.option_id).map((option) => ({
      optionId: option.option_id!, quantity: option.quantity, groupChoices: option.choices, split: option.price_mode === "highest" || option.price_mode === "average",
    })),
  }));
  for (const [itemId, amount] of estimateConsumption(sold, recipe)) {
    await recordMovement(tx, { storeId: order.store_id, itemId, kind: "producao", quantity: -amount, orderId, process, estimate: true });
  }
}

/** Auditoria de uma movimentação manual (perda, ajuste, compra), na mesma transação. */
export async function auditMovement(tx: Tx, input: { actorId: string; actorRole: string; storeId: string; itemId: string; kind: MovementKind; quantity: number; reason?: string | null; balance: number }) {
  await audit({
    actorId: input.actorId, actorRole: input.actorRole, action: `estoque.${input.kind}`, module: "estoque", entityType: "stock_item",
    entityId: input.itemId, storeId: input.storeId, reason: input.reason ?? null, details: { quantidade: input.quantity, saldo_depois: input.balance },
  }, tx);
}
