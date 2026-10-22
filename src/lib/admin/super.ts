import "server-only";
import { sql } from "@/lib/db";
import type { Range } from "./range";

// Números do super admin, sempre dos registros reais. Definições (as mesmas dos outros relatórios):
// - pedido "realizado" no período = criado no período (qualquer situação);
// - "vendido" = pago e não recusado, cancelado, expirado nem reembolsado por inteiro, pela data do pagamento;
// - vendas = total pago − reembolsado; faturamento bruto = produtos + entrega, antes de descontos;
// - receita da plataforma = taxas por pedido (lançamentos de taxa) + comissões (pedidos pagos pelo app) + anúncios.
// Valores em centavos inteiros; datas no horário de Maceió.

type Window = { from: Date; to: Date };
export type Pair = { current: number; previous: number };

export const SOLD = sql`o.paid_at is not null and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')`;
export const DONE_STATUSES = ["delivered", "picked_up", "partially_refunded"];
export const CANCELLED_STATUSES = ["rejected", "cancelled", "refunded", "expired"];
export const PROGRESS_STATUSES = ["paid", "accepted", "preparing", "ready", "out_for_delivery"];

const LOCAL = (column: string) => sql`(${sql.unsafe(column)} at time zone 'America/Maceio')`;
export function bucketSql(bucket: Range["bucket"], column: string) {
  return bucket === "hora"
    ? sql`to_char(${LOCAL(column)}, 'HH24')`
    : bucket === "mes" ? sql`to_char(${LOCAL(column)}, 'YYYY-MM')` : sql`to_char(${LOCAL(column)}, 'YYYY-MM-DD')`;
}

/** Todos os pontos do eixo (horas, dias ou meses do período), para o gráfico não pular os vazios. */
export function bucketKeys(range: Range): string[] {
  if (range.bucket === "hora") return Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
  const keys: string[] = [];
  const cursor = new Date(`${range.firstDay}T12:00:00Z`);
  const last = new Date(`${range.lastDay}T12:00:00Z`);
  while (cursor <= last) {
    const key = range.bucket === "mes" ? cursor.toISOString().slice(0, 7) : cursor.toISOString().slice(0, 10);
    if (keys.at(-1) !== key) keys.push(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function fillSeries(range: Range, rows: { key: string; value: number }[]): { key: string; value: number }[] {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return bucketKeys(range).map((key) => ({ key, value: byKey.get(key) ?? 0 }));
}

const city = (column: string, cityId: string | null) => (cityId ? sql`and ${sql.unsafe(column)} = ${cityId}` : sql``);

// --------------------------------------------------------------- painel

export type Overview = {
  stores: { total: number; active: number; inactive: number; suspended: number; pending: number; closed: number };
  storesNew: Pair;
  companies: { total: number; closedByCompany: number };
  companiesNew: Pair;
  companiesClosed: Pair;
  couriers: { total: number; active: number; inactive: number; online: number; available: number; delivering: number; storeCouriers: number };
  orders: { total: Pair; done: Pair; cancelled: Pair; pending: Pair; progress: Pair };
  sales: { gmvCents: Pair; grossCents: Pair; sold: Pair; feeCents: Pair; commissionCents: Pair; adsRevenueCents: Pair };
  ads: { live: number; campaigns: Pair };
  ordersSeries: { key: string; value: number }[];
  salesSeries: { key: string; value: number }[];
};

async function periodNumbers(window: Window, cityId: string | null) {
  const [[orders], [sales], [fees], [stores], [companies], [ads]] = await Promise.all([
    sql<{ total: number; done: number; cancelled: number; pending: number; progress: number }[]>`
      select count(*)::int as total,
             count(*) filter (where o.status::text = any(${DONE_STATUSES}))::int as done,
             count(*) filter (where o.status::text = any(${CANCELLED_STATUSES}))::int as cancelled,
             count(*) filter (where o.status = 'awaiting_payment')::int as pending,
             count(*) filter (where o.status::text = any(${PROGRESS_STATUSES}))::int as progress
      from orders o where o.created_at >= ${window.from} and o.created_at < ${window.to} ${city("o.city_id", cityId)}`,
    sql<{ sold: number; gmv: number; gross: number; commission: number }[]>`
      select count(*)::int as sold, coalesce(sum(o.total_cents - o.refunded_cents), 0)::bigint::int as gmv,
             coalesce(sum(o.subtotal_cents + o.delivery_fee_cents), 0)::bigint::int as gross,
             coalesce(sum(o.commission_cents), 0)::bigint::int as commission
      from orders o where ${SOLD} and o.paid_at >= ${window.from} and o.paid_at < ${window.to} ${city("o.city_id", cityId)}`,
    sql<{ fee: number }[]>`
      select coalesce(sum(f.amount_cents), 0)::bigint::int as fee
      from fee_entries f join stores s on s.id = f.store_id
      where f.kind in ('order_fee', 'order_fee_reversal') and f.created_at >= ${window.from} and f.created_at < ${window.to} ${city("s.city_id", cityId)}`,
    sql<{ created: number }[]>`
      select count(*)::int as created from stores s where s.created_at >= ${window.from} and s.created_at < ${window.to} ${city("s.city_id", cityId)}`,
    sql<{ created: number; closed: number }[]>`
      select
        (select count(*)::int from (select s.owner_id from stores s where true ${city("s.city_id", cityId)} group by s.owner_id
           having min(s.created_at) >= ${window.from} and min(s.created_at) < ${window.to}) first_store) as created,
        (select count(*)::int from stores s where s.closed_by_kind = 'empresa' and s.closed_at >= ${window.from} and s.closed_at < ${window.to} ${city("s.city_id", cityId)}) as closed`,
    sql<{ campaigns: number; revenue: number }[]>`
      select count(*)::int as campaigns, coalesce(sum(c.price_cents), 0)::bigint::int as revenue
      from ad_campaigns c join stores s on s.id = c.store_id
      where c.created_at >= ${window.from} and c.created_at < ${window.to} ${city("s.city_id", cityId)}`,
  ]);
  return { orders, sales, fees, stores, companies, ads };
}

export async function overview(range: Range, cityId: string | null, at: Date): Promise<Overview> {
  const [current, previous, [stores], [companies], [couriers], [live], ordersSeries, salesSeries] = await Promise.all([
    periodNumbers(range, cityId),
    periodNumbers(range.previous, cityId),
    sql<Overview["stores"][]>`
      select count(*) filter (where s.closed_at is null)::int as total,
             count(*) filter (where s.closed_at is null and s.status = 'active')::int as active,
             count(*) filter (where s.closed_at is null and s.status = 'paused')::int as inactive,
             count(*) filter (where s.closed_at is null and s.status = 'suspended')::int as suspended,
             count(*) filter (where s.closed_at is null and s.status = 'pending')::int as pending,
             count(*) filter (where s.closed_at is not null)::int as closed
      from stores s where true ${city("s.city_id", cityId)}`,
    sql<Overview["companies"][]>`
      select count(distinct s.owner_id) filter (where s.closed_at is null)::int as total,
             count(*) filter (where s.closed_by_kind = 'empresa')::int as "closedByCompany"
      from stores s where true ${city("s.city_id", cityId)}`,
    sql<Overview["couriers"][]>`
      select count(*)::int as total,
             count(*) filter (where c.status = 'active')::int as active,
             count(*) filter (where c.status <> 'active')::int as inactive,
             count(*) filter (where c.status = 'active' and c.last_seen_at > ${at}::timestamptz - interval '5 minutes')::int as online,
             count(*) filter (where c.status = 'active' and c.available)::int as available,
             (select count(distinct o.courier_id)::int from orders o where o.status = 'out_for_delivery' and o.courier_id is not null ${city("o.city_id", cityId)}) as delivering,
             (select count(*)::int from store_members m join stores s on s.id = m.store_id where m.role = 'courier' and m.active and s.closed_at is null ${city("s.city_id", cityId)}) as "storeCouriers"
      from couriers c where true ${city("c.city_id", cityId)}`,
    sql<{ live: number }[]>`
      select count(*)::int as live from ad_campaigns c join stores s on s.id = c.store_id
      where c.status = 'ativa' and c.starts_at <= ${at} and c.ends_at > ${at} and s.closed_at is null ${city("s.city_id", cityId)}`,
    sql<{ key: string; value: number }[]>`
      select ${bucketSql(range.bucket, "o.created_at")} as key, count(*)::int as value
      from orders o where o.created_at >= ${range.from} and o.created_at < ${range.to} ${city("o.city_id", cityId)} group by 1`,
    sql<{ key: string; value: number }[]>`
      select ${bucketSql(range.bucket, "o.paid_at")} as key, sum(o.total_cents - o.refunded_cents)::bigint::int as value
      from orders o where ${SOLD} and o.paid_at >= ${range.from} and o.paid_at < ${range.to} ${city("o.city_id", cityId)} group by 1`,
  ]);
  const pair = (pick: (numbers: typeof current) => number): Pair => ({ current: pick(current), previous: pick(previous) });
  return {
    stores, companies, couriers,
    storesNew: pair((n) => n.stores.created),
    companiesNew: pair((n) => n.companies.created),
    companiesClosed: pair((n) => n.companies.closed),
    orders: {
      total: pair((n) => n.orders.total), done: pair((n) => n.orders.done), cancelled: pair((n) => n.orders.cancelled),
      pending: pair((n) => n.orders.pending), progress: pair((n) => n.orders.progress),
    },
    sales: {
      gmvCents: pair((n) => n.sales.gmv), grossCents: pair((n) => n.sales.gross), sold: pair((n) => n.sales.sold),
      feeCents: pair((n) => n.fees.fee), commissionCents: pair((n) => n.sales.commission), adsRevenueCents: pair((n) => n.ads.revenue),
    },
    ads: { live: live.live, campaigns: pair((n) => n.ads.campaigns) },
    ordersSeries: fillSeries(range, ordersSeries),
    salesSeries: fillSeries(range, salesSeries),
  };
}

// ---------------------------------------------------------------- pedidos

export const ORDER_GROUPS = {
  vendidos: { label: "Vendidos (pagos e não desfeitos)", statuses: [...PROGRESS_STATUSES, ...DONE_STATUSES] },
  concluidos: { label: "Concluídos", statuses: DONE_STATUSES },
  cancelados: { label: "Cancelados e recusados", statuses: CANCELLED_STATUSES },
  andamento: { label: "Em andamento", statuses: PROGRESS_STATUSES },
  pendentes: { label: "Aguardando pagamento", statuses: ["awaiting_payment"] },
} as const;
export type OrderGroup = keyof typeof ORDER_GROUPS;

export type OrderFilters = { cityId: string | null; storeId?: string; ownerId?: string; courierId?: string; group?: OrderGroup; search?: string };

function orderWhere(window: Window, filters: OrderFilters) {
  const like = filters.search ? `%${filters.search.replace(/[\\%_]/g, "\\$&")}%` : null;
  return sql`
    o.created_at >= ${window.from} and o.created_at < ${window.to}
    ${city("o.city_id", filters.cityId)}
    ${filters.storeId ? sql`and o.store_id = ${filters.storeId}` : sql``}
    ${filters.ownerId ? sql`and s.owner_id = ${filters.ownerId}` : sql``}
    ${filters.courierId ? sql`and o.courier_id = ${filters.courierId}` : sql``}
    ${filters.group ? sql`and o.status::text = any(${[...ORDER_GROUPS[filters.group].statuses]})` : sql``}
    ${like ? sql`and (o.code ilike ${like} or o.customer_name ilike ${like})` : sql``}`;
}

export async function ordersReport(range: Range, filters: OrderFilters) {
  const where = orderWhere(range, filters);
  const [[totals], series, topStores, hours] = await Promise.all([
    sql<{ total: number; done: number; cancelled: number; progress: number; pending: number; value: number; sold: number; sold_value: number }[]>`
      select count(*)::int as total,
             count(*) filter (where o.status::text = any(${DONE_STATUSES}))::int as done,
             count(*) filter (where o.status::text = any(${CANCELLED_STATUSES}))::int as cancelled,
             count(*) filter (where o.status::text = any(${PROGRESS_STATUSES}))::int as progress,
             count(*) filter (where o.status = 'awaiting_payment')::int as pending,
             coalesce(sum(o.total_cents), 0)::bigint::int as value,
             count(*) filter (where ${SOLD})::int as sold,
             coalesce(sum(o.total_cents - o.refunded_cents) filter (where ${SOLD}), 0)::bigint::int as sold_value
      from orders o join stores s on s.id = o.store_id where ${where}`,
    sql<{ key: string; value: number }[]>`
      select ${bucketSql(range.bucket, "o.created_at")} as key, count(*)::int as value
      from orders o join stores s on s.id = o.store_id where ${where} group by 1`,
    sql<{ id: string; name: string; orders: number }[]>`
      select s.id, s.name, count(*)::int as orders from orders o join stores s on s.id = o.store_id
      where ${where} group by s.id, s.name order by orders desc, s.name limit 10`,
    sql<{ hour: number; orders: number }[]>`
      select extract(hour from ${LOCAL("o.created_at")})::int as hour, count(*)::int as orders
      from orders o join stores s on s.id = o.store_id where ${where} group by 1 order by 1`,
  ]);
  return {
    totals, ticketCents: totals.sold === 0 ? 0 : Math.round(totals.sold_value / totals.sold),
    series: fillSeries(range, series), topStores, hours,
  };
}

export type OrderRow = {
  id: string; code: string; status: string; store_id: string; store_name: string; customer_name: string; courier_name: string | null;
  total_cents: number; refunded_cents: number; channel: string; fulfillment: string; created_at: Date;
};

export async function listOrdersPage(range: Range, filters: OrderFilters, page: { limit: number; offset: number; sort: "recentes" | "antigos" | "maior" | "menor" }) {
  const where = orderWhere(range, filters);
  const order = { recentes: sql`o.created_at desc`, antigos: sql`o.created_at asc`, maior: sql`o.total_cents desc, o.created_at desc`, menor: sql`o.total_cents asc, o.created_at desc` }[page.sort];
  const [[{ total }], rows] = await Promise.all([
    sql<{ total: number }[]>`select count(*)::int as total from orders o join stores s on s.id = o.store_id where ${where}`,
    sql<OrderRow[]>`
      select o.id, o.code, o.status::text, s.id as store_id, s.name as store_name, o.customer_name, cp.full_name as courier_name,
             o.total_cents, o.refunded_cents, o.channel::text, o.fulfillment::text, o.created_at
      from orders o join stores s on s.id = o.store_id left join profiles cp on cp.id = o.courier_id
      where ${where} order by ${order}, o.id limit ${page.limit} offset ${page.offset}`,
  ]);
  return { total, rows };
}

// ----------------------------------------------------- vendas por loja

export type StoreSales = {
  id: string; name: string; orders: number; sold: number; gross_cents: number; discount_cents: number; sales_cents: number;
  refunded_cents: number; cancelled_cents: number; store_net_cents: number; fee_cents: number; commission_cents: number; fees_paid_cents: number;
};

/**
 * Por loja, no período: bruto (produtos + entrega), descontos, vendas (pago − reembolsado), reembolsos,
 * valor dos pedidos cancelados/recusados, líquido da loja (vendas − taxas e comissões do Chegô),
 * taxas e comissões geradas e o que a loja de fato pagou ao Chegô (cobranças de taxa pagas).
 */
export async function salesByStore(range: Window, cityId: string | null): Promise<StoreSales[]> {
  return sql<StoreSales[]>`
    with o as (
      select o.* from orders o where o.paid_at >= ${range.from} and o.paid_at < ${range.to} ${city("o.city_id", cityId)}
    ), sold as (
      select store_id, count(*)::int as sold,
             sum(subtotal_cents + delivery_fee_cents)::bigint as gross, sum(discount_cents)::bigint as discount,
             sum(total_cents - refunded_cents)::bigint as sales, sum(commission_cents)::bigint as commission
      from o where status not in ('rejected', 'cancelled', 'refunded', 'expired') group by store_id
    ), all_orders as (
      select store_id, count(*)::int as orders, sum(refunded_cents)::bigint as refunded,
             sum(total_cents) filter (where status in ('rejected', 'cancelled', 'refunded', 'expired'))::bigint as cancelled
      from o group by store_id
    ), fees as (
      select f.store_id, sum(f.amount_cents)::bigint as fee from fee_entries f
      where f.kind in ('order_fee', 'order_fee_reversal') and f.created_at >= ${range.from} and f.created_at < ${range.to} group by f.store_id
    ), paid as (
      select c.store_id, sum(c.amount_cents)::bigint as paid from fee_charges c
      where c.status = 'paid' and c.paid_at >= ${range.from} and c.paid_at < ${range.to} group by c.store_id
    )
    select s.id, s.name,
           coalesce(a.orders, 0) as orders, coalesce(so.sold, 0) as sold,
           coalesce(so.gross, 0)::int as gross_cents, coalesce(so.discount, 0)::int as discount_cents, coalesce(so.sales, 0)::int as sales_cents,
           coalesce(a.refunded, 0)::int as refunded_cents, coalesce(a.cancelled, 0)::int as cancelled_cents,
           (coalesce(so.sales, 0) - coalesce(f.fee, 0) - coalesce(so.commission, 0))::int as store_net_cents,
           coalesce(f.fee, 0)::int as fee_cents, coalesce(so.commission, 0)::int as commission_cents, coalesce(p.paid, 0)::int as fees_paid_cents
    from stores s
    left join all_orders a on a.store_id = s.id left join sold so on so.store_id = s.id
    left join fees f on f.store_id = s.id left join paid p on p.store_id = s.id
    where (a.orders is not null or f.fee is not null or p.paid is not null) ${city("s.city_id", cityId)}
    order by sales_cents desc, s.name`;
}

// ------------------------------------------------------------ motoboys

export async function couriersReport(range: Range, cityId: string | null) {
  const inRange = sql`o.completed_at >= ${range.from} and o.completed_at < ${range.to}`;
  const [series, [stats], ranking, recent] = await Promise.all([
    sql<{ key: string; value: number }[]>`
      select ${bucketSql(range.bucket, "o.completed_at")} as key, count(*)::int as value
      from orders o where o.status = 'delivered' and o.courier_id is not null and ${inRange} ${city("o.city_id", cityId)} group by 1`,
    sql<{ delivered: number; cancelled: number; avg_minutes: string | null }[]>`
      select count(*) filter (where o.status = 'delivered' and ${inRange})::int as delivered,
             count(*) filter (where o.status in ('cancelled', 'refunded') and o.created_at >= ${range.from} and o.created_at < ${range.to})::int as cancelled,
             avg(extract(epoch from o.completed_at - o.dispatched_at) / 60) filter (where o.status = 'delivered' and o.dispatched_at is not null and ${inRange}) as avg_minutes
      from orders o where o.courier_id is not null ${city("o.city_id", cityId)}`,
    sql<{ id: string; name: string; kind: string; deliveries: number; avg_minutes: string | null }[]>`
      select p.id, p.full_name as name, coalesce(c.kind::text, 'loja') as kind, count(*)::int as deliveries,
             avg(extract(epoch from o.completed_at - o.dispatched_at) / 60) filter (where o.dispatched_at is not null) as avg_minutes
      from orders o join profiles p on p.id = o.courier_id left join couriers c on c.profile_id = p.id
      where o.status = 'delivered' and ${inRange} ${city("o.city_id", cityId)}
      group by p.id, p.full_name, c.kind order by deliveries desc, p.full_name limit 15`,
    sql<{ id: string; code: string; courier: string; store: string; status: string; dispatched_at: Date | null; completed_at: Date | null }[]>`
      select o.id, o.code, p.full_name as courier, s.name as store, o.status::text, o.dispatched_at, o.completed_at
      from orders o join profiles p on p.id = o.courier_id join stores s on s.id = o.store_id
      where o.courier_id is not null and coalesce(o.completed_at, o.dispatched_at, o.created_at) >= ${range.from}
        and coalesce(o.completed_at, o.dispatched_at, o.created_at) < ${range.to} ${city("o.city_id", cityId)}
      order by coalesce(o.completed_at, o.dispatched_at, o.created_at) desc limit 30`,
  ]);
  return {
    series: fillSeries(range, series), delivered: stats.delivered, cancelled: stats.cancelled,
    avgMinutes: stats.avg_minutes === null ? null : Math.round(Number(stats.avg_minutes)),
    ranking: ranking.map((row) => ({ ...row, avgMinutes: row.avg_minutes === null ? null : Math.round(Number(row.avg_minutes)) })),
    recent,
  };
}

/** Entregadores da rede com a situação de cada um: conexão, disponibilidade e entrega em andamento são coisas diferentes. */
export async function courierRoster(cityId: string | null, status: "todos" | "ativos" | "inativos" | "online" | "disponiveis" | "entregando", at: Date) {
  const rows = await sql<{ id: string; name: string; kind: string; status: string; available: boolean; last_seen_at: Date | null; delivering: number; city: string }[]>`
    select p.id, p.full_name as name, c.kind::text, c.status::text, c.available, c.last_seen_at, ci.name as city,
           (select count(*)::int from orders o where o.courier_id = p.id and o.status = 'out_for_delivery') as delivering
    from couriers c join profiles p on p.id = c.profile_id join cities ci on ci.id = c.city_id
    where true ${city("c.city_id", cityId)} order by p.full_name`;
  const online = (row: (typeof rows)[number]) => row.status === "active" && !!row.last_seen_at && at.getTime() - row.last_seen_at.getTime() <= 5 * 60_000;
  return rows.map((row) => ({ ...row, online: online(row) })).filter((row) =>
    status === "todos" ? true
    : status === "ativos" ? row.status === "active"
    : status === "inativos" ? row.status !== "active"
    : status === "online" ? row.online
    : status === "disponiveis" ? row.status === "active" && row.available
    : row.delivering > 0);
}
