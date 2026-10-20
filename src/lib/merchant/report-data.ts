import "server-only";
import { sql } from "@/lib/db";
import { addDays } from "@/lib/fees/rules";
import { fromLocal } from "@/lib/time";
import { isSegment, type ReportOrder, type Segment } from "./report-rules";

// Os pedidos de uma loja para os relatórios: UMA consulta, com todos os filtros. Os
// indicadores, os gráficos e a listagem são calculados a partir destas mesmas linhas
// (report-rules.ts), então nunca divergem. Chame só para o dono daquela loja.

export const PRESETS = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7": "Últimos 7 dias",
  "30": "Últimos 30 dias",
  mes: "Este mês",
  ano: "Este ano",
} as const;
export type Preset = keyof typeof PRESETS;

export const STATUS_FILTERS = {
  vendidos: "Vendidos",
  concluidos: "Concluídos",
  andamento: "Em andamento",
  cancelados: "Recusados e cancelados",
} as const;

export const MODALITIES = { delivery: "Entrega", pickup: "Retirada", mesa: "Mesa", balcao: "Balcão" } as const;
export type Modality = keyof typeof MODALITIES;

export type ReportFilters = {
  preset: Preset | "personalizado";
  from: string;
  to: string;
  status?: keyof typeof STATUS_FILTERS;
  bairro?: string;
  pagamento?: "pix" | "card" | "cash";
  /** Entrega ou retirada pelo app, mesa ou balcão. */
  modalidade?: Modality;
  /** Funcionário que mexeu no pedido (aceitou, preparou, entregou, fechou a conta...). */
  funcionario?: string;
  cliente?: string;
  pedido?: string;
  produto?: string;
  hora?: number;
  segmento?: Segment;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: string | undefined, max: number) => value?.trim().slice(0, max) || undefined;

/** Lê e valida os filtros da URL. Datas no horário de Maceió; o padrão é "últimos 30 dias". */
export function parseReportFilters(params: Record<string, string | undefined>, today: string): ReportFilters {
  // Links antigos: ?dias=7 etc.
  const legacy = params.dias && !params.periodo ? (params.dias === "1" ? "hoje" : params.dias) : undefined;
  const periodo = params.periodo ?? legacy;
  let preset: ReportFilters["preset"] = periodo && periodo in PRESETS ? (periodo as Preset) : "30";
  let from: string;
  let to = today;
  if (params.de && DATE.test(params.de) && (!params.ate || DATE.test(params.ate))) {
    preset = "personalizado";
    from = params.de;
    to = params.ate && params.ate >= params.de ? params.ate : params.de;
  } else if (legacy === "90") {
    preset = "personalizado";
    from = addDays(today, -89);
  } else {
    from = preset === "hoje" ? today
      : preset === "ontem" ? addDays(today, -1)
      : preset === "7" ? addDays(today, -6)
      : preset === "mes" ? `${today.slice(0, 8)}01`
      : preset === "ano" ? `${today.slice(0, 4)}-01-01`
      : addDays(today, -29);
    if (preset === "ontem") to = addDays(today, -1);
  }
  const hora = params.hora !== undefined && /^\d{1,2}$/.test(params.hora) && Number(params.hora) < 24 ? Number(params.hora) : undefined;
  return {
    preset, from, to,
    status: params.status && params.status in STATUS_FILTERS ? (params.status as ReportFilters["status"]) : undefined,
    bairro: params.bairro && UUID.test(params.bairro) ? params.bairro : undefined,
    pagamento: params.pagamento === "pix" || params.pagamento === "card" || params.pagamento === "cash" ? params.pagamento : undefined,
    modalidade: params.modalidade && params.modalidade in MODALITIES ? (params.modalidade as Modality) : undefined,
    funcionario: params.funcionario && UUID.test(params.funcionario) ? params.funcionario : undefined,
    cliente: text(params.cliente, 60),
    pedido: text(params.pedido, 30),
    produto: text(params.produto, 120),
    hora,
    segmento: isSegment(params.segmento) ? params.segmento : undefined,
  };
}

/** Os filtros de volta para a URL (sem o segmento, que é de cada link), para manter o contexto. */
export function filtersToParams(filters: ReportFilters, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  if (filters.preset === "personalizado") {
    params.set("de", filters.from);
    params.set("ate", filters.to);
  } else if (filters.preset !== "30") {
    params.set("periodo", filters.preset);
  }
  const optional: [string, string | number | undefined][] = [
    ["status", filters.status], ["bairro", filters.bairro], ["pagamento", filters.pagamento], ["modalidade", filters.modalidade], ["funcionario", filters.funcionario],
    ["cliente", filters.cliente], ["pedido", filters.pedido], ["produto", filters.produto], ["hora", filters.hora],
  ];
  for (const [key, value] of optional) if (value !== undefined && value !== "") params.set(key, String(value));
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

const STATUS_SQL = {
  vendidos: sql`o.status not in ('rejected', 'cancelled', 'refunded', 'expired')`,
  concluidos: sql`o.status in ('delivered', 'picked_up', 'partially_refunded')`,
  andamento: sql`o.status in ('paid', 'accepted', 'preparing', 'ready', 'out_for_delivery')`,
  cancelados: sql`o.status in ('rejected', 'cancelled')`,
};

/** A lista de pedidos da loja no período, com os filtros (menos o segmento, aplicado depois). */
export async function loadReportOrders(storeId: string, filters: ReportFilters): Promise<ReportOrder[]> {
  const from = fromLocal(filters.from, 0);
  const to = fromLocal(addDays(filters.to, 1), 0);
  const like = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await sql<{
    id: string; code: string; paid_at: Date; status: string; fulfillment: "delivery" | "pickup"; payment_method: "pix" | "card" | "cash";
    payment_collection: "store" | "app"; customer_name: string; neighborhood: string | null; total_cents: number; refunded_cents: number;
    delivery_fee_cents: number; discount_cents: number; discount_paid_by: string | null; store_amount_cents: number;
    refunded_from_store: number; accepted_at: Date | null; ready_at: Date | null; channel: "app" | "mesa" | "balcao"; subtotal_cents: number;
    items_count: number; fee_cents: number; cost_cents: number | null;
  }[]>`
    select o.id, o.code, o.paid_at, o.status, o.fulfillment, o.payment_method, o.payment_collection, o.customer_name,
           n.name as neighborhood, o.total_cents, o.refunded_cents, o.delivery_fee_cents, o.discount_cents, o.discount_paid_by,
           o.store_amount_cents, o.accepted_at, o.ready_at,
           coalesce((select sum(r.store_share_cents) from refunds r where r.order_id = o.id), 0)::int as refunded_from_store,
           o.channel, o.subtotal_cents,
           coalesce((select sum(i.quantity) from order_items i where i.order_id = o.id and i.removed_at is null), 0)::int as items_count,
           coalesce((select sum(f.amount_cents) from fee_entries f where f.order_id = o.id and f.kind in ('order_fee', 'order_fee_reversal')), 0)::int as fee_cents,
           (select round(sum(-m.quantity * si.unit_cost_cents))::int from stock_movements m join stock_items si on si.id = m.item_id
             where (m.order_id = o.id or m.bill_item_id in (select bi.id from table_bill_items bi join table_bills b on b.id = bi.bill_id where b.order_id = o.id))
               and m.kind in ('venda', 'producao', 'devolucao') and si.unit_cost_cents is not null) as cost_cents
    from orders o
    left join neighborhoods n on n.id = o.neighborhood_id
    where o.store_id = ${storeId} and o.paid_at is not null
      and o.paid_at >= ${from} and o.paid_at < ${to}
      ${filters.status ? sql`and ${STATUS_SQL[filters.status]}` : sql``}
      ${filters.bairro ? sql`and o.neighborhood_id = ${filters.bairro}` : sql``}
      ${filters.pagamento ? sql`and o.payment_method = ${filters.pagamento}` : sql``}
      ${filters.modalidade === "delivery" || filters.modalidade === "pickup" ? sql`and o.channel = 'app' and o.fulfillment = ${filters.modalidade}` : sql``}
      ${filters.modalidade === "mesa" || filters.modalidade === "balcao" ? sql`and o.channel = ${filters.modalidade}` : sql``}
      ${filters.funcionario ? sql`and (exists (select 1 from order_status_history h where h.order_id = o.id and h.changed_by = ${filters.funcionario}) or exists (select 1 from table_bills b where b.order_id = o.id and (b.opened_by = ${filters.funcionario} or b.closed_by = ${filters.funcionario})))` : sql``}
      ${filters.cliente ? sql`and (unaccent(o.customer_name) ilike unaccent(${like(filters.cliente)}) or o.customer_phone like ${like(filters.cliente.replace(/\D/g, "") || "~")})` : sql``}
      ${filters.pedido ? sql`and o.code ilike ${like(filters.pedido)}` : sql``}
      ${filters.produto ? sql`and exists (select 1 from order_items i where i.order_id = o.id and i.removed_at is null and unaccent(i.name) ilike unaccent(${like(filters.produto)}))` : sql``}
      ${filters.hora !== undefined ? sql`and extract(hour from (o.paid_at at time zone 'America/Maceio')) = ${filters.hora}` : sql``}
    order by o.paid_at desc
    limit 5000`;

  return rows.map((row) => ({
    id: row.id, code: row.code, paidAt: row.paid_at, status: row.status, fulfillment: row.fulfillment, paymentMethod: row.payment_method,
    collection: row.payment_collection, customerName: row.customer_name, neighborhood: row.neighborhood,
    totalCents: row.total_cents, refundedCents: row.refunded_cents, deliveryFeeCents: row.delivery_fee_cents, discountCents: row.discount_cents,
    storeDiscountCents: row.discount_paid_by === "store" ? row.discount_cents : 0, storeAmountCents: row.store_amount_cents,
    refundedFromStoreCents: row.refunded_from_store, acceptedAt: row.accepted_at, readyAt: row.ready_at,
    channel: row.channel, subtotalCents: row.subtotal_cents, itemsCount: row.items_count, platformFeeCents: row.fee_cents, costCents: row.cost_cents,
  }));
}

/** Produtos mais vendidos entre os pedidos vendidos desta mesma lista. */
export async function topProducts(orderIds: string[], limit = 10) {
  if (orderIds.length === 0) return [];
  return sql<{ name: string; quantity: number; total_cents: number }[]>`
    select i.name, sum(i.quantity)::int as quantity, sum(i.line_total_cents)::int as total_cents
    from order_items i
    where i.order_id = any(${orderIds}::uuid[]) and i.removed_at is null
    group by i.name order by quantity desc, total_cents desc limit ${limit}`;
}

/** Bairros onde a loja teve pedido (para o filtro). */
export async function reportNeighborhoods(storeId: string) {
  return sql<{ id: string; name: string }[]>`
    select distinct n.id, n.name from orders o join neighborhoods n on n.id = o.neighborhood_id
    where o.store_id = ${storeId} and o.paid_at is not null order by n.name`;
}
