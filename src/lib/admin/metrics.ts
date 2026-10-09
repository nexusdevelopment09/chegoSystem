import "server-only";
import { sql } from "@/lib/db";

// Platform-wide numbers for the admin. "Sold" = paid and not refused,
// cancelled, expired or fully refunded.

export type Period = { from: Date; to: Date };

export type Dashboard = {
  orders: number;
  gmvCents: number;
  ticketCents: number;
  commissionCents: number;
  serviceFeeCents: number;
  platformDiscountCents: number;
  subscriptionCents: number;
  platformRevenueCents: number;
  newCustomers: number;
  repurchaseRate: number | null;
  rejected: number;
  cancelled: number;
  avgAcceptMinutes: number | null;
  avgDeliveryMinutes: number | null;
  activeStores: number;
  byDay: { day: string; orders: number; gmvCents: number }[];
  byStore: { name: string; orders: number; gmvCents: number }[];
};

export async function dashboard(period: Period, cityId: string | null): Promise<Dashboard> {
  const city = cityId ? sql`and o.city_id = ${cityId}` : sql``;
  const sold = sql`o.paid_at is not null and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')`;
  const inPeriod = sql`o.paid_at >= ${period.from} and o.paid_at < ${period.to}`;

  const [[totals], [refusals], [subscriptions], [customers], [repurchase], [stores], byDay, byStore] = await Promise.all([
    sql<{ orders: number; gmv: number; commission: number; fee: number; discount: number; accept: string | null; delivery: string | null }[]>`
      select count(*)::int as orders,
             coalesce(sum(o.total_cents - o.refunded_cents), 0)::int as gmv,
             coalesce(sum(o.commission_cents), 0)::int as commission,
             coalesce(sum(o.service_fee_cents), 0)::int as fee,
             coalesce(sum(o.discount_cents) filter (where o.discount_paid_by = 'platform'), 0)::int as discount,
             avg(extract(epoch from o.accepted_at - o.paid_at) / 60) as accept,
             avg(extract(epoch from o.completed_at - o.paid_at) / 60) filter (where o.fulfillment = 'delivery') as delivery
      from orders o where ${sold} and ${inPeriod} ${city}`,
    sql<{ rejected: number; cancelled: number }[]>`
      select count(*) filter (where o.status = 'rejected')::int as rejected,
             count(*) filter (where o.status = 'cancelled')::int as cancelled
      from orders o where ${inPeriod} ${city}`,
    sql<{ total: number }[]>`
      select coalesce(sum(i.amount_cents), 0)::int as total
      from invoices i join stores s on s.id = i.store_id
      where i.status = 'paid' and i.paid_at >= ${period.from} and i.paid_at < ${period.to}
        ${cityId ? sql`and s.city_id = ${cityId}` : sql``}`,
    sql<{ total: number }[]>`
      select count(*)::int as total from profiles p
      where p.role = 'customer' and p.created_at >= ${period.from} and p.created_at < ${period.to}
        ${cityId ? sql`and p.city_id = ${cityId}` : sql``}`,
    // Of the customers who bought in the 30 days before the period ended, how many bought more than once.
    sql<{ buyers: number; repeat: number }[]>`
      select count(*)::int as buyers, count(*) filter (where purchases > 1)::int as repeat
      from (
        select o.customer_id, count(*) as purchases
        from orders o
        where ${sold} and o.paid_at >= ${period.to}::timestamptz - interval '30 days' and o.paid_at < ${period.to} ${city}
        group by o.customer_id
      ) by_customer`,
    sql<{ total: number }[]>`
      select count(*)::int as total from stores s
      where s.status in ('active', 'paused') ${cityId ? sql`and s.city_id = ${cityId}` : sql``}`,
    sql<{ day: string; orders: number; gmv: number }[]>`
      select to_char(o.paid_at at time zone 'America/Maceio', 'YYYY-MM-DD') as day, count(*)::int as orders,
             sum(o.total_cents - o.refunded_cents)::int as gmv
      from orders o where ${sold} and ${inPeriod} ${city}
      group by 1 order by 1`,
    sql<{ name: string; orders: number; gmv: number }[]>`
      select s.name, count(*)::int as orders, sum(o.total_cents - o.refunded_cents)::int as gmv
      from orders o join stores s on s.id = o.store_id
      where ${sold} and ${inPeriod} ${city}
      group by s.name order by gmv desc limit 10`,
  ]);

  return {
    orders: totals.orders,
    gmvCents: totals.gmv,
    ticketCents: totals.orders === 0 ? 0 : Math.round(totals.gmv / totals.orders),
    commissionCents: totals.commission,
    serviceFeeCents: totals.fee,
    platformDiscountCents: totals.discount,
    subscriptionCents: subscriptions.total,
    platformRevenueCents: totals.commission + totals.fee + subscriptions.total - totals.discount,
    newCustomers: customers.total,
    repurchaseRate: repurchase.buyers === 0 ? null : repurchase.repeat / repurchase.buyers,
    rejected: refusals.rejected,
    cancelled: refusals.cancelled,
    avgAcceptMinutes: totals.accept === null ? null : Math.round(Number(totals.accept)),
    avgDeliveryMinutes: totals.delivery === null ? null : Math.round(Number(totals.delivery)),
    activeStores: stores.total,
    byDay: byDay.map((row) => ({ day: row.day, orders: row.orders, gmvCents: row.gmv })),
    byStore: byStore.map((row) => ({ name: row.name, orders: row.orders, gmvCents: row.gmv })),
  };
}

export type CommissionLine = {
  storeId: string; storeName: string; document: string | null; orders: number; gmvCents: number;
  commissionCents: number; serviceFeeCents: number; subscriptionCents: number;
};

/** What each store paid the platform in a period: the base for the accountant's invoices. */
export async function commissionsByStore(period: Period): Promise<CommissionLine[]> {
  const rows = await sql<{
    id: string; name: string; document: string | null; orders: number; gmv: number; commission: number; fee: number; subscription: number;
  }[]>`
    select s.id, s.name, sp.document_number as document,
           count(o.id)::int as orders,
           coalesce(sum(o.total_cents - o.refunded_cents), 0)::int as gmv,
           coalesce(sum(o.commission_cents), 0)::int as commission,
           coalesce(sum(o.service_fee_cents), 0)::int as fee,
           coalesce((select sum(i.amount_cents) from invoices i
                     where i.store_id = s.id and i.status = 'paid' and i.paid_at >= ${period.from} and i.paid_at < ${period.to}), 0)::int as subscription
    from stores s
    join store_private sp on sp.store_id = s.id
    left join orders o on o.store_id = s.id and o.paid_at >= ${period.from} and o.paid_at < ${period.to}
      and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')
    group by s.id, s.name, sp.document_number
    having count(o.id) > 0 or exists (
      select 1 from invoices i where i.store_id = s.id and i.status = 'paid' and i.paid_at >= ${period.from} and i.paid_at < ${period.to})
    order by commission desc, s.name`;

  return rows.map((row) => ({
    storeId: row.id, storeName: row.name, document: row.document, orders: row.orders, gmvCents: row.gmv,
    commissionCents: row.commission, serviceFeeCents: row.fee, subscriptionCents: row.subscription,
  }));
}

export type Mismatch = { orderId: string; code: string; storeName: string; problem: string };

/**
 * Reconciliation: what the gateway says it charged, split and refunded
 * against what the system calculated. Any line here needs a human look.
 */
export async function reconciliation(period: Period): Promise<{ checked: number; mismatches: Mismatch[] }> {
  const rows = await sql<{
    id: string; code: string; store_name: string; total_cents: number; store_amount_cents: number; platform_amount_cents: number;
    refunded_cents: number; status: string; paid_amount: number | null; gateway_store: number | null; gateway_platform: number | null;
    payments_approved: number; refunds_total: number; ledger_net: number;
  }[]>`
    select o.id, o.code, s.name as store_name, o.total_cents, o.store_amount_cents, o.platform_amount_cents, o.refunded_cents, o.status,
           p.amount_cents as paid_amount,
           (p.raw_payload -> 'split' ->> 'storeAmountCents')::int as gateway_store,
           (p.raw_payload -> 'split' ->> 'platformAmountCents')::int as gateway_platform,
           (select count(*)::int from payments x where x.order_id = o.id and x.status in ('approved', 'refunded', 'partially_refunded')) as payments_approved,
           coalesce((select sum(r.amount_cents) from refunds r where r.order_id = o.id), 0)::int as refunds_total,
           coalesce((select sum(case when l.direction = 'credit' then l.amount_cents else -l.amount_cents end)
                     from ledger_entries l where l.order_id = o.id), 0)::int as ledger_net
    from orders o
    join stores s on s.id = o.store_id
    left join lateral (
      select amount_cents, raw_payload from payments x
      where x.order_id = o.id and x.status in ('approved', 'refunded', 'partially_refunded')
      order by x.created_at desc limit 1
    ) p on true
    where o.paid_at >= ${period.from} and o.paid_at < ${period.to}
    order by o.paid_at desc`;

  const mismatches: Mismatch[] = [];
  for (const row of rows) {
    const problems: string[] = [];
    if (row.payments_approved === 0) problems.push("pedido pago sem pagamento aprovado no gateway");
    if (row.payments_approved > 1) problems.push("mais de um pagamento aprovado para o mesmo pedido");
    if (row.paid_amount !== null && row.paid_amount !== row.total_cents) problems.push("valor cobrado diferente do total do pedido");
    if (row.gateway_store !== null && row.gateway_store !== row.store_amount_cents) problems.push("parte da loja no split diferente da calculada");
    if (row.gateway_platform !== null && row.gateway_platform !== row.platform_amount_cents) problems.push("parte da plataforma no split diferente da calculada");
    if (row.refunds_total !== row.refunded_cents) problems.push("reembolsos registrados não batem com o valor devolvido no pedido");
    if (row.ledger_net !== row.total_cents - row.refunded_cents) problems.push("lançamentos do financeiro não fecham com o pedido");
    for (const problem of problems) mismatches.push({ orderId: row.id, code: row.code, storeName: row.store_name, problem });
  }
  return { checked: rows.length, mismatches };
}
