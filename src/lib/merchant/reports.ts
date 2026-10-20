import "server-only";
import { sql } from "@/lib/db";

// Números de venda de uma loja. Chame só para o dono daquela loja (ou o admin).
// "Vendido" significa pago e não recusado, cancelado nem reembolsado por inteiro.

const SOLD = sql`o.paid_at is not null and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')`;
const LOCAL = sql`(o.paid_at at time zone 'America/Maceio')`;

export type Period = { from: Date; to: Date };

export type StoreReport = {
  orders: number;
  grossCents: number;
  ticketCents: number;
  netCents: number;
  rejected: number;
  cancelled: number;
  refusalRate: number;
  avgAcceptMinutes: number | null;
  avgPrepMinutes: number | null;
  byDay: { day: string; orders: number; grossCents: number }[];
  topProducts: { name: string; quantity: number; totalCents: number }[];
  byHour: { hour: number; orders: number }[];
};

export async function storeReport(storeId: string, period: Period): Promise<StoreReport> {
  const [[totals], [refusals], byDay, topProducts, byHour] = await Promise.all([
    sql<{ orders: number; gross: number; net: number; accept: string | null; prep: string | null }[]>`
      select count(*)::int as orders,
             coalesce(sum(o.total_cents - o.refunded_cents), 0)::int as gross,
             coalesce(sum(o.store_amount_cents), 0)::int as net,
             avg(extract(epoch from o.accepted_at - o.paid_at) / 60) as accept,
             avg(extract(epoch from o.ready_at - o.accepted_at) / 60) as prep
      from orders o
      where o.store_id = ${storeId} and ${SOLD} and o.paid_at >= ${period.from} and o.paid_at < ${period.to}`,
    sql<{ paid: number; rejected: number; cancelled: number }[]>`
      select count(*)::int as paid,
             count(*) filter (where o.status = 'rejected')::int as rejected,
             count(*) filter (where o.status = 'cancelled')::int as cancelled
      from orders o
      where o.store_id = ${storeId} and o.paid_at >= ${period.from} and o.paid_at < ${period.to}`,
    sql<{ day: string; orders: number; gross: number }[]>`
      select to_char(${LOCAL}, 'YYYY-MM-DD') as day, count(*)::int as orders,
             sum(o.total_cents - o.refunded_cents)::int as gross
      from orders o
      where o.store_id = ${storeId} and ${SOLD} and o.paid_at >= ${period.from} and o.paid_at < ${period.to}
      group by 1 order by 1`,
    sql<{ name: string; quantity: number; total: number }[]>`
      select i.name, sum(i.quantity)::int as quantity, sum(i.line_total_cents)::int as total
      from order_items i join orders o on o.id = i.order_id
      where o.store_id = ${storeId} and ${SOLD} and i.removed_at is null
        and o.paid_at >= ${period.from} and o.paid_at < ${period.to}
      group by i.name order by quantity desc, total desc limit 10`,
    sql<{ hour: number; orders: number }[]>`
      select extract(hour from ${LOCAL})::int as hour, count(*)::int as orders
      from orders o
      where o.store_id = ${storeId} and ${SOLD} and o.paid_at >= ${period.from} and o.paid_at < ${period.to}
      group by 1 order by 1`,
  ]);

  // Reembolsos devolvidos pela loja diminuem o que ela recebe de fato.
  const [{ refunded }] = await sql<{ refunded: number }[]>`
    select coalesce(sum(r.store_share_cents), 0)::int as refunded
    from refunds r join orders o on o.id = r.order_id
    where o.store_id = ${storeId} and ${SOLD} and o.paid_at >= ${period.from} and o.paid_at < ${period.to}`;

  return {
    orders: totals.orders,
    grossCents: totals.gross,
    ticketCents: totals.orders === 0 ? 0 : Math.round(totals.gross / totals.orders),
    netCents: totals.net - refunded,
    rejected: refusals.rejected,
    cancelled: refusals.cancelled,
    refusalRate: refusals.paid === 0 ? 0 : (refusals.rejected + refusals.cancelled) / refusals.paid,
    avgAcceptMinutes: totals.accept === null ? null : Math.round(Number(totals.accept)),
    avgPrepMinutes: totals.prep === null ? null : Math.round(Number(totals.prep)),
    byDay: byDay.map((row) => ({ day: row.day, orders: row.orders, grossCents: row.gross })),
    topProducts: topProducts.map((row) => ({ name: row.name, quantity: row.quantity, totalCents: row.total })),
    byHour,
  };
}

export type StatementLine = {
  orderId: string; code: string; paidAt: Date; status: string; grossCents: number; deliveryFeeCents: number;
  commissionCents: number; storeDiscountCents: number; refundedFromStoreCents: number; netCents: number;
};

/** Uma linha por pedido pago: o que o cliente pagou, o que ficou com a plataforma, o que a loja recebe. */
export async function storeStatement(storeId: string, period: Period): Promise<StatementLine[]> {
  const rows = await sql<{
    id: string; code: string; paid_at: Date; status: string; total_cents: number; delivery_fee_cents: number;
    commission_cents: number; discount_cents: number; discount_paid_by: string | null; store_amount_cents: number; refunded: number;
  }[]>`
    select o.id, o.code, o.paid_at, o.status, o.total_cents, o.delivery_fee_cents, o.commission_cents, o.discount_cents,
           o.discount_paid_by, o.store_amount_cents,
           coalesce((select sum(r.store_share_cents) from refunds r where r.order_id = o.id), 0)::int as refunded
    from orders o
    where o.store_id = ${storeId} and o.paid_at is not null and o.paid_at >= ${period.from} and o.paid_at < ${period.to}
    order by o.paid_at desc
    limit 500`;

  return rows.map((row) => ({
    orderId: row.id, code: row.code, paidAt: row.paid_at, status: row.status, grossCents: row.total_cents,
    deliveryFeeCents: row.delivery_fee_cents, commissionCents: row.commission_cents,
    storeDiscountCents: row.discount_paid_by === "store" ? row.discount_cents : 0,
    refundedFromStoreCents: row.refunded, netCents: row.store_amount_cents - row.refunded,
  }));
}

/** A data do repasse de um pedido pago pelo app (a regra mora em report-rules.ts). */
export { payoutDate } from "./report-rules";
