import "server-only";
import { sql } from "@/lib/db";

// Relatório anual da loja: números por ano e mês, no horário de Maceió, com a mesma regra
// de "vendido" dos outros relatórios (pago e não recusado, cancelado nem reembolsado por
// inteiro). Anos sem pedido aparecem como "sem dados", nunca com zeros inventados.

export type MonthRow = {
  year: number; month: number; received: number; sold: number; completed: number; cancelled: number;
  salesCents: number; grossCents: number; discountCents: number; refundCents: number; items: number; feeCents: number;
};

const LOCAL = sql`(o.paid_at at time zone 'America/Maceio')`;
const SOLD = sql`o.status not in ('rejected', 'cancelled', 'refunded', 'expired')`;

/** Anos em que a loja teve pedido, do mais recente para o mais antigo. */
export async function availableYears(storeId: string): Promise<number[]> {
  const rows = await sql<{ year: number }[]>`
    select distinct extract(year from ${LOCAL})::int as year from orders o where o.store_id = ${storeId} and o.paid_at is not null order by year desc`;
  return rows.map((row) => row.year);
}

/** Recorte "até o mesmo dia de cada ano" (para comparar um ano incompleto com os anteriores). */
export type Cutoff = { month: number; day: number } | null;
const cutoffSql = (cutoff: Cutoff) => cutoff
  ? sql`and (extract(month from ${LOCAL}) < ${cutoff.month} or (extract(month from ${LOCAL}) = ${cutoff.month} and extract(day from ${LOCAL}) <= ${cutoff.day}))`
  : sql``;

export async function monthlyByYear(storeId: string, years: number[], cutoff: Cutoff): Promise<MonthRow[]> {
  if (years.length === 0) return [];
  const rows = await sql<{
    year: number; month: number; received: number; sold: number; completed: number; cancelled: number; sales: number; gross: number;
    discount: number; refund: number; items: number; fee: number;
  }[]>`
    select extract(year from ${LOCAL})::int as year, extract(month from ${LOCAL})::int as month,
           count(*)::int as received,
           count(*) filter (where ${SOLD})::int as sold,
           count(*) filter (where o.status in ('delivered', 'picked_up', 'partially_refunded'))::int as completed,
           count(*) filter (where o.status in ('rejected', 'cancelled'))::int as cancelled,
           coalesce(sum(o.total_cents - o.refunded_cents) filter (where ${SOLD}), 0)::bigint::int as sales,
           coalesce(sum(o.subtotal_cents + o.delivery_fee_cents) filter (where ${SOLD}), 0)::bigint::int as gross,
           coalesce(sum(o.discount_cents) filter (where ${SOLD}), 0)::int as discount,
           coalesce(sum(o.refunded_cents), 0)::int as refund,
           coalesce(sum((select sum(i.quantity) from order_items i where i.order_id = o.id and i.removed_at is null)) filter (where ${SOLD}), 0)::int as items,
           coalesce(sum((select sum(f.amount_cents) from fee_entries f where f.order_id = o.id and f.kind in ('order_fee', 'order_fee_reversal'))), 0)::int as fee
    from orders o
    where o.store_id = ${storeId} and o.paid_at is not null
      and extract(year from ${LOCAL}) = any(${years}::int[]) ${cutoffSql(cutoff)}
    group by 1, 2 order by 1, 2`;
  return rows.map((row) => ({
    year: row.year, month: row.month, received: row.received, sold: row.sold, completed: row.completed, cancelled: row.cancelled,
    salesCents: row.sales, grossCents: row.gross, discountCents: row.discount, refundCents: row.refund, items: row.items, feeCents: row.fee,
  }));
}

export async function breakdownsByYear(storeId: string, years: number[], cutoff: Cutoff) {
  if (years.length === 0) return { products: [], payments: [], channels: [] };
  const [products, payments, channels] = await Promise.all([
    sql<{ year: number; name: string; quantity: number; total_cents: number }[]>`
      select year, name, quantity, total_cents from (
        select year, name, quantity, total_cents,
               row_number() over (partition by year order by quantity desc, total_cents desc) as position
        from (
          select extract(year from ${LOCAL})::int as year, i.name, sum(i.quantity)::int as quantity, sum(i.line_total_cents)::int as total_cents
          from order_items i join orders o on o.id = i.order_id
          where o.store_id = ${storeId} and o.paid_at is not null and ${SOLD} and i.removed_at is null
            and extract(year from ${LOCAL}) = any(${years}::int[]) ${cutoffSql(cutoff)}
          group by 1, 2) grouped
        ) ranked
      where position <= 5 order by year desc, quantity desc`,
    sql<{ year: number; method: "pix" | "card" | "cash"; count: number; total_cents: number }[]>`
      select extract(year from ${LOCAL})::int as year, o.payment_method as method, count(*)::int as count, sum(o.total_cents - o.refunded_cents)::int as total_cents
      from orders o where o.store_id = ${storeId} and o.paid_at is not null and ${SOLD} and extract(year from ${LOCAL}) = any(${years}::int[]) ${cutoffSql(cutoff)}
      group by 1, 2 order by 1 desc, total_cents desc`,
    sql<{ year: number; channel: string; count: number; total_cents: number }[]>`
      select extract(year from ${LOCAL})::int as year, case when o.channel = 'app' then o.fulfillment::text else o.channel::text end as channel,
             count(*)::int as count, sum(o.total_cents - o.refunded_cents)::int as total_cents
      from orders o where o.store_id = ${storeId} and o.paid_at is not null and ${SOLD} and extract(year from ${LOCAL}) = any(${years}::int[]) ${cutoffSql(cutoff)}
      group by 1, 2 order by 1 desc, total_cents desc`,
  ]);
  return { products, payments, channels };
}
