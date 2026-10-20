import "server-only";
import { sql } from "@/lib/db";
import { replenishment, stockLevel, type MovementKind, type Replenishment, type StockLevel, type StockUnit } from "./rules";

// Leituras do estoque. Sempre filtradas pela loja de quem está no painel.

export type StockItem = {
  id: string; name: string; category: string | null; sku: string | null; unit: StockUnit; quantity: number; minQuantity: number;
  idealQuantity: number | null; unitCostCents: number | null; supplier: string | null; leadTimeDays: number | null; storageLocation: string | null;
  perishable: boolean; status: "ativo" | "inativo" | "indisponivel"; productId: string | null; productName: string | null;
  lastPurchaseAt: Date | null; lastMovementAt: Date | null; level: StockLevel; nextExpiry: string | null;
};

type ItemRow = {
  id: string; name: string; category: string | null; sku: string | null; unit: StockUnit; quantity: string; min_quantity: string;
  ideal_quantity: string | null; unit_cost_cents: number | null; supplier: string | null; lead_time_days: number | null; storage_location: string | null;
  perishable: boolean; status: StockItem["status"]; product_id: string | null; product_name: string | null; last_purchase_at: Date | null;
  last_movement_at: Date | null; next_expiry: string | null;
};

const toItem = (row: ItemRow): StockItem => ({
  id: row.id, name: row.name, category: row.category, sku: row.sku, unit: row.unit, quantity: Number(row.quantity), minQuantity: Number(row.min_quantity),
  idealQuantity: row.ideal_quantity === null ? null : Number(row.ideal_quantity), unitCostCents: row.unit_cost_cents, supplier: row.supplier,
  leadTimeDays: row.lead_time_days, storageLocation: row.storage_location, perishable: row.perishable, status: row.status, productId: row.product_id,
  productName: row.product_name, lastPurchaseAt: row.last_purchase_at, lastMovementAt: row.last_movement_at,
  level: stockLevel(Number(row.quantity), Number(row.min_quantity)), nextExpiry: row.next_expiry,
});

const ITEM_COLUMNS = sql`
  i.id, i.name, i.category, i.sku, i.unit, i.quantity::text, i.min_quantity::text, i.ideal_quantity::text, i.unit_cost_cents, i.supplier,
  i.lead_time_days, i.storage_location, i.perishable, i.status, i.product_id, p.name as product_name, i.last_purchase_at, i.last_movement_at,
  (select min(l.expires_at)::text from stock_lots l where l.item_id = i.id and l.remaining_quantity > 0 and l.discarded_at is null) as next_expiry`;

export async function listStockItems(storeId: string, filters: { q?: string; category?: string; status?: string } = {}): Promise<StockItem[]> {
  const like = filters.q ? `%${filters.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const rows = await sql<ItemRow[]>`
    select ${ITEM_COLUMNS}
    from stock_items i left join products p on p.id = i.product_id
    where i.store_id = ${storeId}
      ${like ? sql`and (unaccent(i.name) ilike unaccent(${like}) or i.sku ilike ${like})` : sql``}
      ${filters.category ? sql`and i.category = ${filters.category}` : sql``}
      ${filters.status === "ativo" || filters.status === "inativo" || filters.status === "indisponivel" ? sql`and i.status = ${filters.status}` : sql``}
    order by i.name
    limit 1000`;
  return rows.map(toItem);
}

export async function getStockItem(storeId: string, itemId: string): Promise<StockItem | null> {
  const [row] = await sql<ItemRow[]>`
    select ${ITEM_COLUMNS} from stock_items i left join products p on p.id = i.product_id where i.id = ${itemId} and i.store_id = ${storeId}`;
  return row ? toItem(row) : null;
}

export type Movement = {
  id: string; itemId: string; itemName: string; unit: StockUnit; kind: MovementKind; quantity: number; balanceAfter: number; reason: string | null;
  orderId: string | null; orderCode: string | null; byName: string | null; process: string | null; createdAt: Date;
};

export async function listMovements(storeId: string, filters: { itemId?: string; kind?: string; from?: Date; to?: Date; limit?: number; offset?: number }) {
  const rows = await sql<{
    id: string; item_id: string; item_name: string; unit: StockUnit; kind: MovementKind; quantity: string; balance_after: string; reason: string | null;
    order_id: string | null; order_code: string | null; by_name: string | null; process: string | null; created_at: Date; total: number;
  }[]>`
    select m.id, m.item_id, i.name as item_name, i.unit, m.kind, m.quantity::text, m.balance_after::text, m.reason, m.order_id, o.code as order_code,
           p.full_name as by_name, m.process, m.created_at, count(*) over ()::int as total
    from stock_movements m join stock_items i on i.id = m.item_id
    left join orders o on o.id = m.order_id left join profiles p on p.id = m.created_by
    where m.store_id = ${storeId}
      ${filters.itemId ? sql`and m.item_id = ${filters.itemId}` : sql``}
      ${filters.kind ? sql`and m.kind = ${filters.kind}` : sql``}
      ${filters.from ? sql`and m.created_at >= ${filters.from}` : sql``}
      ${filters.to ? sql`and m.created_at < ${filters.to}` : sql``}
    order by m.created_at desc, m.id
    limit ${filters.limit ?? 50} offset ${filters.offset ?? 0}`;
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((row): Movement => ({
      id: row.id, itemId: row.item_id, itemName: row.item_name, unit: row.unit, kind: row.kind, quantity: Number(row.quantity), balanceAfter: Number(row.balance_after),
      reason: row.reason, orderId: row.order_id, orderCode: row.order_code, byName: row.by_name, process: row.process, createdAt: row.created_at,
    })),
  };
}

export type Lot = {
  id: string; itemId: string; itemName: string; unit: StockUnit; receivedQuantity: number; remainingQuantity: number; receivedAt: string;
  manufacturedAt: string | null; expiresAt: string | null; supplier: string | null; costCents: number | null; discardedAt: Date | null;
};

export async function listLots(storeId: string, filters: { itemId?: string; onlyOpen?: boolean } = {}): Promise<Lot[]> {
  const rows = await sql<{
    id: string; item_id: string; item_name: string; unit: StockUnit; received_quantity: string; remaining_quantity: string; received_at: string;
    manufactured_at: string | null; expires_at: string | null; supplier: string | null; cost_cents: number | null; discarded_at: Date | null;
  }[]>`
    select l.id, l.item_id, i.name as item_name, i.unit, l.received_quantity::text, l.remaining_quantity::text, l.received_at::text,
           l.manufactured_at::text, l.expires_at::text, l.supplier, l.cost_cents, l.discarded_at
    from stock_lots l join stock_items i on i.id = l.item_id
    where l.store_id = ${storeId}
      ${filters.itemId ? sql`and l.item_id = ${filters.itemId}` : sql``}
      ${filters.onlyOpen ? sql`and l.remaining_quantity > 0 and l.discarded_at is null` : sql``}
    order by l.expires_at nulls last, l.received_at
    limit 500`;
  return rows.map((row) => ({
    id: row.id, itemId: row.item_id, itemName: row.item_name, unit: row.unit, receivedQuantity: Number(row.received_quantity),
    remainingQuantity: Number(row.remaining_quantity), receivedAt: row.received_at, manufacturedAt: row.manufactured_at, expiresAt: row.expires_at,
    supplier: row.supplier, costCents: row.cost_cents, discardedAt: row.discarded_at,
  }));
}

export type Alert = { id: string; itemId: string; itemName: string; unit: StockUnit; lotId: string | null; kind: "baixo" | "vencendo" | "vencido" | "conferir"; detail: string | null; openedAt: Date; resolvedAt: Date | null; quantity: number; minQuantity: number; idealQuantity: number | null };

export async function listAlerts(storeId: string, resolved = false, limit = 200): Promise<Alert[]> {
  const rows = await sql<{
    id: string; item_id: string; item_name: string; unit: StockUnit; lot_id: string | null; kind: Alert["kind"]; detail: string | null;
    opened_at: Date; resolved_at: Date | null; quantity: string; min_quantity: string; ideal_quantity: string | null;
  }[]>`
    select a.id, a.item_id, i.name as item_name, i.unit, a.lot_id, a.kind, a.detail, a.opened_at, a.resolved_at,
           i.quantity::text, i.min_quantity::text, i.ideal_quantity::text
    from stock_alerts a join stock_items i on i.id = a.item_id
    where a.store_id = ${storeId} and ${resolved ? sql`a.resolved_at is not null` : sql`a.resolved_at is null`}
    order by ${resolved ? sql`a.resolved_at desc` : sql`a.kind, a.opened_at`}
    limit ${limit}`;
  return rows.map((row) => ({
    id: row.id, itemId: row.item_id, itemName: row.item_name, unit: row.unit, lotId: row.lot_id, kind: row.kind, detail: row.detail, openedAt: row.opened_at,
    resolvedAt: row.resolved_at, quantity: Number(row.quantity), minQuantity: Number(row.min_quantity), idealQuantity: row.ideal_quantity === null ? null : Number(row.ideal_quantity),
  }));
}

export async function stockSettings(storeId: string) {
  const [row] = await sql<{ expiry_warning_days: number[]; allow_negative: boolean }[]>`
    select expiry_warning_days, allow_negative from store_stock_settings where store_id = ${storeId}`;
  return { warningDays: row?.expiry_warning_days ?? [30, 15, 7, 3], allowNegative: row?.allow_negative ?? false };
}

export type Suggestion = StockItem & Replenishment & { out7: number; out30: number; hasRecipe: boolean; estimatedCostCents: number | null };

/**
 * Sugestão de compra de cada item ativo, a partir das saídas reais registradas (vendas e
 * consumo das fichas técnicas, já descontadas as devoluções). Itens sem nenhum consumo
 * registrado só entram pela regra do mínimo/ideal cadastrado.
 */
export async function suggestions(storeId: string, at: Date, coverDays = 7): Promise<Suggestion[]> {
  const items = (await listStockItems(storeId, { status: "ativo" }));
  if (items.length === 0) return [];
  const day = 86_400_000;
  const rows = await sql<{ item_id: string; out7: string; prev7: string; out30: string }[]>`
    select item_id,
           coalesce(-sum(quantity) filter (where created_at >= ${new Date(at.getTime() - 7 * day)}), 0)::text as out7,
           coalesce(-sum(quantity) filter (where created_at >= ${new Date(at.getTime() - 14 * day)} and created_at < ${new Date(at.getTime() - 7 * day)}), 0)::text as prev7,
           coalesce(-sum(quantity), 0)::text as out30
    from stock_movements
    where store_id = ${storeId} and kind in ('venda', 'producao', 'devolucao') and created_at >= ${new Date(at.getTime() - 30 * day)} and created_at < ${at}
    group by item_id`;
  const recipeItems = new Set((await sql<{ item_id: string }[]>`select distinct item_id from recipe_lines where store_id = ${storeId}`).map((row) => row.item_id));
  const usage = new Map(rows.map((row) => [row.item_id, { out7: Math.max(0, Number(row.out7)), prev7: Math.max(0, Number(row.prev7)), out30: Math.max(0, Number(row.out30)) }]));
  return items.map((item) => {
    const use = usage.get(item.id) ?? { out7: 0, prev7: 0, out30: 0 };
    const result = replenishment({
      quantity: item.quantity, minQuantity: item.minQuantity, idealQuantity: item.idealQuantity, leadTimeDays: item.leadTimeDays,
      out7: use.out7, outPrev7: use.prev7, out30: use.out30, coverDays,
    });
    return {
      ...item, ...result, out7: use.out7, out30: use.out30, hasRecipe: recipeItems.has(item.id) || item.productId !== null,
      estimatedCostCents: item.unitCostCents !== null ? Math.round(item.unitCostCents * result.suggested) : null,
    };
  }).sort((a, b) => Number(b.suggested > 0) - Number(a.suggested > 0) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || a.name.localeCompare(b.name, "pt-BR"));
}
