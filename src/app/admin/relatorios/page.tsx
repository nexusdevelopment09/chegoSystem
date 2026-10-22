import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { Pagination } from "@/components/admin/Pagination";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { adminContext, pageNumber } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { bucketSql, fillSeries } from "@/lib/admin/super";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { EVENT_LABELS } from "../lojas/[id]/AccountPanel";

export const metadata: Metadata = { title: "Relatórios" };

type SearchParams = Promise<Record<string, string | undefined>>;
const PAGE = 40;

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { cities, cityId, range } = await adminContext(params);
  const page = pageNumber(params.pagina);
  const city = cityId ? sql`and s.city_id = ${cityId}` : sql``;
  const inRange = (column: string) => sql`${sql.unsafe(column)} >= ${range.from} and ${sql.unsafe(column)} < ${range.to}`;
  const inPrev = (column: string) => sql`${sql.unsafe(column)} >= ${range.previous.from} and ${sql.unsafe(column)} < ${range.previous.to}`;

  const [[counts], created, closed, reasons, [retention], events] = await Promise.all([
    sql<{ created: number; created_prev: number; by_company: number; by_company_prev: number; by_admin: number; suspended: number; reactivated: number; deactivated: number }[]>`
      select
        (select count(*)::int from stores s where ${inRange("s.created_at")} ${city}) as created,
        (select count(*)::int from stores s where ${inPrev("s.created_at")} ${city}) as created_prev,
        (select count(*)::int from stores s where s.closed_by_kind = 'empresa' and ${inRange("s.closed_at")} ${city}) as by_company,
        (select count(*)::int from stores s where s.closed_by_kind = 'empresa' and ${inPrev("s.closed_at")} ${city}) as by_company_prev,
        (select count(*)::int from stores s where s.closed_by_kind = 'admin' and ${inRange("s.closed_at")} ${city}) as by_admin,
        (select count(*)::int from store_status_events e join stores s on s.id = e.store_id where e.kind = 'suspensa' and ${inRange("e.created_at")} ${city}) as suspended,
        (select count(*)::int from store_status_events e join stores s on s.id = e.store_id where e.kind = 'reativada' and ${inRange("e.created_at")} ${city}) as reactivated,
        (select count(*)::int from store_status_events e join stores s on s.id = e.store_id where e.kind = 'desativada' and ${inRange("e.created_at")} ${city}) as deactivated`,
    sql<{ key: string; value: number }[]>`select ${bucketSql(range.bucket, "s.created_at")} as key, count(*)::int as value from stores s where ${inRange("s.created_at")} ${city} group by 1`,
    sql<{ key: string; value: number }[]>`select ${bucketSql(range.bucket, "s.closed_at")} as key, count(*)::int as value from stores s where ${inRange("s.closed_at")} ${city} group by 1`,
    sql<{ reason: string; kind: string; total: number }[]>`
      select s.closed_reason as reason, s.closed_by_kind as kind, count(*)::int as total from stores s
      where ${inRange("s.closed_at")} ${city} group by 1, 2 order by total desc, reason limit 15`,
    // Retenção: das lojas aprovadas e ainda no Chegô no início do período, quantas continuam no fim.
    sql<{ at_start: number; kept: number }[]>`
      select count(*)::int as at_start, count(*) filter (where s.closed_at is null or s.closed_at >= ${range.to})::int as kept
      from stores s where s.created_at < ${range.from} and s.status <> 'pending' and (s.closed_at is null or s.closed_at >= ${range.from}) ${city}`,
    sql<{ id: string; store_id: string; store: string; kind: string; reason: string | null; actor: string | null; process: string | null; created_at: Date; total: number }[]>`
      select e.id, e.store_id, s.name as store, e.kind, e.reason, p.full_name as actor, e.process, e.created_at, count(*) over ()::int as total
      from store_status_events e join stores s on s.id = e.store_id left join profiles p on p.id = e.actor_id
      where ${inRange("e.created_at")} ${city} order by e.created_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
  ]);
  const closedTotal = counts.by_company + counts.by_admin;
  const net = counts.created - closedTotal;
  const retentionRate = retention.at_start === 0 ? null : retention.kept / retention.at_start;
  const total = events[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Relatórios de empresas</h1>
      <RangeFilter path="/admin/relatorios" range={range} cities={cities} cityId={cityId} />

      <KpiGrid>
        <Kpi label="Lojas cadastradas" value={counts.created} current={counts.created} previous={counts.created_prev} />
        <Kpi label="Encerradas pela empresa" value={counts.by_company} current={counts.by_company} previous={counts.by_company_prev} inverse hint="A empresa pediu para sair" href="/admin/excluidas?por=empresa" />
        <Kpi label="Excluídas pelo Chegô" value={counts.by_admin} href="/admin/excluidas?por=admin" />
        <Kpi label="Crescimento líquido" value={net > 0 ? `+${net}` : net} hint="Cadastradas − encerradas e excluídas" />
        <Kpi label="Suspensões aplicadas" value={counts.suspended} href="/admin/suspensas" />
        <Kpi label="Reativações" value={counts.reactivated} />
        <Kpi label="Desativadas pelo Chegô" value={counts.deactivated} hint="Pausadas administrativamente, sem suspensão" />
        <Kpi label="Retenção" value={retentionRate === null ? "—" : `${(retentionRate * 100).toFixed(1).replace(".", ",")}%`}
          hint={`${retention.kept} de ${retention.at_start} lojas que já estavam no Chegô continuaram no período`} />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Lojas cadastradas"><SeriesChart title="Cadastros" points={fillSeries(range, created)} kind="count" testId="chart-signups" /></Panel>
        <Panel title="Lojas encerradas e excluídas"><SeriesChart title="Encerramentos" points={fillSeries(range, closed)} kind="count" /></Panel>
      </div>

      <Panel title="Motivos de encerramento">
        {reasons.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum encerramento no período.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {reasons.map((row) => (
              <li key={`${row.kind}-${row.reason}`} className="flex justify-between gap-2 border-b border-cream py-1">
                <span>{row.reason} <span className="text-coffee-soft">· {row.kind === "empresa" ? "pela empresa" : "pelo Chegô"}</span></span>
                <strong className="tabular-nums">{closedTotal === 0 ? row.total : `${row.total} (${Math.round((row.total / closedTotal) * 100)}%)`}</strong>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Histórico de mudanças de situação">
        {events.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma mudança no período.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Histórico de situação">
            <table className="w-full min-w-[640px] text-sm" data-testid="status-events">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Quando</th><th className="pr-2">Loja</th><th className="pr-2">O que mudou</th><th className="pr-2">Quem</th><th>Motivo</th></tr></thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="py-1 pr-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                    <td className="pr-2"><Link href={`/admin/lojas/${row.store_id}`} className="underline">{row.store}</Link></td>
                    <td className="pr-2">{EVENT_LABELS[row.kind] ?? row.kind}</td>
                    <td className="pr-2">{row.actor ?? row.process ?? "Sistema"}</td>
                    <td>{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} size={PAGE} href={(target) => withQuery("/admin/relatorios", { ...range.query, cidade: cityId, pagina: String(target) })} />
      </Panel>
    </div>
  );
}
