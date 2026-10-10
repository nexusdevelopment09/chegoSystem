import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { resolvePeriod } from "@/lib/admin/period";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { ALL_STATUSES, STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

export const metadata: Metadata = { title: "Pedidos" };

// Grupos de situações usados pelos números do painel.
const GROUPS = {
  vendidos: "Vendidos (pagos e não desfeitos)",
  entregues: "Entregues ou retirados",
  problemas: "Recusados e cancelados",
} as const;
type Group = keyof typeof GROUPS;

type SearchParams = Promise<{ q?: string; situacao?: string; periodo?: string; dia?: string; cidade?: string; loja?: string }>;
type Named = { id: string; name: string };

export default function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

const UUID = /^[0-9a-f-]{36}$/i;

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const params = await searchParams;
  const at = await now();

  const status = ALL_STATUSES.includes(params.situacao as OrderStatus) ? (params.situacao as OrderStatus) : null;
  const group = params.situacao && params.situacao in GROUPS ? (params.situacao as Group) : null;
  const period = resolvePeriod(params, at);
  const term = (params.q ?? "").trim().slice(0, 60);
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

  const cityId = params.cidade && UUID.test(params.cidade) ? params.cidade : null;
  const storeId = params.loja && UUID.test(params.loja) ? params.loja : null;
  const [cities, stores] = await Promise.all([
    cityId ? sql<Named[]>`select id, name from cities where id = ${cityId}` : Promise.resolve([] as Named[]),
    storeId ? sql<Named[]>`select id, name from stores where id = ${storeId}` : Promise.resolve([] as Named[]),
  ]);
  const city = cities[0] ?? null;
  const store = stores[0] ?? null;

  // As mesmas condições que o painel usa para contar, para a lista bater com o número clicado.
  // O período vale sobre a data do pagamento, como no painel.
  const where = sql`
    true
    ${status ? sql`and o.status = ${status}::order_status` : sql``}
    ${group === "vendidos" ? sql`and o.paid_at is not null and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')` : sql``}
    ${group === "entregues" ? sql`and o.completed_at is not null and o.status in ('delivered', 'picked_up', 'partially_refunded')` : sql``}
    ${group === "problemas" ? sql`and o.status in ('rejected', 'cancelled')` : sql``}
    ${period ? sql`and o.paid_at >= ${period.from} and o.paid_at < ${period.to}` : sql``}
    ${city ? sql`and o.city_id = ${city.id}` : sql``}
    ${store ? sql`and o.store_id = ${store.id}` : sql``}
    ${term ? sql`and (o.code ilike ${pattern} or unaccent(o.customer_name) ilike unaccent(${pattern}) or unaccent(s.name) ilike unaccent(${pattern}))` : sql``}`;

  const [orders, [summary]] = await Promise.all([
    sql<{ id: string; code: string; status: OrderStatus; customer_name: string; store_name: string; total_cents: number; refunded_cents: number; created_at: Date }[]>`
      select o.id, o.code, o.status, o.customer_name, s.name as store_name, o.total_cents, o.refunded_cents, o.created_at
      from orders o join stores s on s.id = o.store_id
      where ${where}
      order by o.created_at desc
      limit 100`,
    sql<{ total: number; net: number }[]>`
      select count(*)::int as total, coalesce(sum(o.total_cents - o.refunded_cents), 0)::int as net
      from orders o join stores s on s.id = o.store_id
      where ${where}`,
  ]);

  // Filtros que vieram de um clique no painel (não têm campo no formulário).
  const kept: Record<string, string | undefined> = { ...(period?.query ?? {}), cidade: city?.id, loja: store?.id };
  const chips = [
    period && `Pagos ${period.text}`,
    city && `Cidade: ${city.name}`,
    store && `Loja: ${store.name}`,
    group && GROUPS[group],
    status && STATUS_LABELS[status],
    term && `Busca: “${term}”`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Pedidos</h1>
      <form className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]" role="search">
        {Object.entries(kept).map(([key, value]) => value && <input key={key} type="hidden" name={key} value={value} />)}
        <input type="search" name="q" defaultValue={term} placeholder="Código, cliente ou loja" aria-label="Buscar por código, cliente ou loja" className={inputClass} />
        <select name="situacao" defaultValue={status ?? group ?? ""} aria-label="Situação" className={inputClass}>
          <option value="">Todas as situações</option>
          <optgroup label="Grupos">
            {(Object.keys(GROUPS) as Group[]).map((value) => <option key={value} value={value}>{GROUPS[value]}</option>)}
          </optgroup>
          <optgroup label="Situação exata">
            {ALL_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
          </optgroup>
        </select>
        <button type="submit" className={buttonClass("secondary")}>Buscar</button>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
          <span className="text-sm font-semibold">Filtrando por:</span>
          {chips.map((chip) => <span key={chip} className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">{chip}</span>)}
          <Link href="/admin/pedidos" className="flex min-h-11 items-center text-sm font-bold text-brand-dark underline">Limpar filtros</Link>
        </div>
      )}

      <p className="text-sm text-coffee-soft" data-testid="list-summary">
        <strong className="text-coffee">{summary.total} pedido{summary.total === 1 ? "" : "s"}</strong> · {formatCents(summary.net)} já sem os reembolsos
        {summary.total > 0 && ` · ticket médio ${formatCents(Math.round(summary.net / summary.total))}`}
        {summary.total > 100 && " · mostrando os 100 mais recentes"}
      </p>
      <ul className="flex flex-col gap-2">
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/admin/pedidos/${order.id}`} data-testid="admin-order" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-3 ring-1 ring-peach hover:ring-brand">
              <span className="min-w-0">
                <strong>{order.code}</strong> · {order.customer_name} · {order.store_name}
                <span className="block text-sm text-coffee-soft">{formatDateTime(order.created_at)}</span>
              </span>
              <span className="text-right">
                <strong>{formatCents(order.total_cents)}</strong>
                <span className="block text-sm font-semibold text-brand-darker">{STATUS_LABELS[order.status]}</span>
                {order.refunded_cents > 0 && <span className="block text-xs text-danger">Reembolsado {formatCents(order.refunded_cents)}</span>}
              </span>
            </Link>
          </li>
        ))}
        {orders.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum pedido encontrado.</li>}
      </ul>
    </div>
  );
}
