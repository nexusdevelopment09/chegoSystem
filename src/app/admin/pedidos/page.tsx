import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bars } from "@/components/ui/Stats";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { Pagination } from "@/components/admin/Pagination";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { adminContext, pageNumber } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { listOrdersPage, ORDER_GROUPS, ordersReport, type OrderFilters, type OrderGroup } from "@/lib/admin/super";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

export const metadata: Metadata = { title: "Pedidos" };

type SearchParams = Promise<Record<string, string | undefined>>;
const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = 30;
const SORTS = { recentes: "Mais recentes", antigos: "Mais antigos", maior: "Maior valor", menor: "Menor valor" } as const;
const CHANNEL = { mesa: "Mesa", balcao: "Balcão" } as Record<string, string>;

export default function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { cities, cityId, range } = await adminContext(params);
  const legacyGroup = params.situacao === "problemas" ? "cancelados" : params.situacao === "entregues" ? "concluidos" : params.situacao;
  const groupKey = params.grupo ?? legacyGroup;
  const group = groupKey && groupKey in ORDER_GROUPS ? (groupKey as OrderGroup) : undefined;
  const search = (params.q ?? "").trim().slice(0, 60);
  const filters: OrderFilters = {
    cityId,
    storeId: params.loja && UUID.test(params.loja) ? params.loja : undefined,
    ownerId: params.empresa && UUID.test(params.empresa) ? params.empresa : undefined,
    courierId: params.motoboy && UUID.test(params.motoboy) ? params.motoboy : undefined,
    group, search: search || undefined,
  };
  const sort = params.ordem && params.ordem in SORTS ? (params.ordem as keyof typeof SORTS) : "recentes";
  const page = pageNumber(params.pagina);
  // Buscar um código sem escolher período procura em qualquer data.
  const anyDate = !!search && !params.periodo && !params.de && !params.dia;
  const window = anyDate ? { ...range, from: new Date(0), to: new Date(Date.UTC(2100, 0, 1)) } : range;

  const [report, list, stores, owners, couriers] = await Promise.all([
    ordersReport(window, filters),
    listOrdersPage(window, filters, { limit: PAGE, offset: (page - 1) * PAGE, sort }),
    sql<{ id: string; name: string }[]>`select id, name from stores where status <> 'pending' ${cityId ? sql`and city_id = ${cityId}` : sql``} order by name limit 500`,
    sql<{ id: string; name: string }[]>`select distinct p.id, p.full_name as name from stores s join profiles p on p.id = s.owner_id ${cityId ? sql`where s.city_id = ${cityId}` : sql``} order by name limit 500`,
    sql<{ id: string; name: string }[]>`
      select p.id, p.full_name as name from profiles p
      where p.id in (select profile_id from couriers union select profile_id from store_members where role = 'courier') order by name limit 500`,
  ]);

  const keep = { loja: filters.storeId, empresa: filters.ownerId, motoboy: filters.courierId, grupo: group, q: search || undefined, ordem: sort === "recentes" ? undefined : sort };
  const here = (extra: Record<string, string | undefined>) => withQuery("/admin/pedidos", { ...range.query, cidade: cityId, ...keep, ...extra });
  const named = (rows: { id: string; name: string }[], id?: string) => rows.find((row) => row.id === id)?.name;
  const active = [
    filters.storeId && { label: `Loja: ${named(stores, filters.storeId) ?? "—"}`, remove: here({ loja: undefined }) },
    filters.ownerId && { label: `Empresa: ${named(owners, filters.ownerId) ?? "—"}`, remove: here({ empresa: undefined }) },
    filters.courierId && { label: `Motoboy: ${named(couriers, filters.courierId) ?? "—"}`, remove: here({ motoboy: undefined }) },
    group && { label: ORDER_GROUPS[group].label, remove: here({ grupo: undefined }) },
    search && { label: `Busca: ${search}`, remove: here({ q: undefined }) },
  ].filter((item): item is { label: string; remove: string } => !!item);
  const { totals } = report;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Pedidos</h1>
      <RangeFilter path="/admin/pedidos" range={range} cities={cities} cityId={cityId} keep={keep} />

      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-2 lg:grid-cols-3" role="search">
        {(params.periodo || params.de) && Object.entries(range.query).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        {cityId && <input type="hidden" name="cidade" value={cityId} />}
        <label className="flex flex-col gap-1 text-xs font-semibold">Código ou cliente<input type="search" name="q" defaultValue={search} placeholder="Ex.: JG-0123" className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Loja
          <select name="loja" defaultValue={filters.storeId ?? ""} className={inputClass}><option value="">Todas</option>{stores.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Empresa (responsável)
          <select name="empresa" defaultValue={filters.ownerId ?? ""} className={inputClass}><option value="">Todas</option>{owners.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Motoboy
          <select name="motoboy" defaultValue={filters.courierId ?? ""} className={inputClass}><option value="">Todos</option>{couriers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Situação
          <select name="grupo" defaultValue={group ?? ""} className={inputClass}><option value="">Todas</option>{Object.entries(ORDER_GROUPS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Ordem
          <select name="ordem" defaultValue={sort} className={inputClass}>{Object.entries(SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
        <button type="submit" className={buttonClass("primary", "min-h-11 self-end sm:col-span-2 lg:col-span-3 lg:justify-self-start")}>Buscar</button>
      </form>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
          {active.map((item) => <Link key={item.label} href={item.remove} className="rounded-full bg-peach px-3 py-1.5 text-sm font-semibold">{item.label} ✕</Link>)}
          <Link href={withQuery("/admin/pedidos", { ...range.query, cidade: cityId })} className="text-sm font-bold text-brand-dark underline">Limpar filtros</Link>
        </div>
      )}
      {anyDate && <p className="text-sm text-coffee-soft">Buscando em qualquer data.</p>}

      <KpiGrid>
        <Kpi label="Pedidos" value={totals.total} href={here({ grupo: undefined, pagina: undefined })} />
        <Kpi label="Concluídos" value={totals.done} href={here({ grupo: "concluidos", pagina: undefined })} />
        <Kpi label="Cancelados e recusados" value={totals.cancelled} href={here({ grupo: "cancelados", pagina: undefined })} />
        <Kpi label="Em andamento" value={totals.progress} href={here({ grupo: "andamento", pagina: undefined })} />
        <Kpi label="Aguardando pagamento" value={totals.pending} href={here({ grupo: "pendentes", pagina: undefined })} />
        <Kpi label="Valor total dos pedidos" value={formatCents(totals.value)} hint="Todos os pedidos da lista, pelo valor cobrado" />
        <Kpi label="Valor médio por pedido" value={formatCents(report.ticketCents)} hint="Dos pedidos vendidos" />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Pedidos ao longo do tempo"><SeriesChart title="Pedidos" points={report.series} kind="count" /></Panel>
        <Panel title="Horários de maior movimento">
          {report.hours.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum pedido no período.</p>
            : <Bars rows={report.hours.map((row) => ({ label: `${row.hour}h`, value: row.orders }))} format={(value) => `${value} pedido${value === 1 ? "" : "s"}`} />}
        </Panel>
      </div>
      <Panel title="Lojas que mais receberam pedidos">
        {report.topStores.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum pedido no período.</p>
          : <Bars rows={report.topStores.map((row) => ({ label: row.name, value: row.orders, href: here({ loja: row.id, pagina: undefined }) }))} format={(value) => `${value} pedido${value === 1 ? "" : "s"}`} />}
      </Panel>

      <Panel title="Histórico de pedidos">
        <p className="text-sm text-coffee-soft" data-testid="list-summary">{list.total} pedido{list.total === 1 ? "" : "s"}</p>
        {list.rows.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum pedido com esses filtros.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pedidos (role para o lado para ver tudo)">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Pedido</th><th className="pr-2">Loja</th><th className="pr-2">Cliente</th><th className="pr-2">Motoboy</th><th className="pr-2 text-right">Valor</th><th className="pr-2">Situação</th><th>Data</th></tr></thead>
              <tbody>
                {list.rows.map((order) => (
                  <tr key={order.id} className="border-t border-cream">
                    <td className="py-1.5 pr-2"><Link href={`/admin/pedidos/${order.id}`} data-testid="admin-order" className="font-bold text-brand-dark underline">{order.code}</Link>
                      {CHANNEL[order.channel] && <span className="ml-1 text-xs text-coffee-soft">{CHANNEL[order.channel]}</span>}</td>
                    <td className="pr-2">{order.store_name}</td>
                    <td className="pr-2">{order.customer_name}</td>
                    <td className="pr-2">{order.courier_name ?? "—"}</td>
                    <td className="pr-2 text-right tabular-nums">{formatCents(order.total_cents)}{order.refunded_cents > 0 && <span className="block text-xs text-coffee-soft">−{formatCents(order.refunded_cents)} reembolso</span>}</td>
                    <td className="pr-2">{STATUS_LABELS[order.status as OrderStatus]}</td>
                    <td className="whitespace-nowrap">{formatDateTime(order.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={list.total} size={PAGE} href={(target) => here({ pagina: String(target) })} />
      </Panel>
    </div>
  );
}
