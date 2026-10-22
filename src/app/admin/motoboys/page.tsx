import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { Bars } from "@/components/ui/Stats";
import { adminContext } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { courierRoster, couriersReport, overview } from "@/lib/admin/super";
import { formatDateTime } from "@/lib/format";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

export const metadata: Metadata = { title: "Motoboys" };

type SearchParams = Promise<Record<string, string | undefined>>;
const STATUSES = { todos: "Todos", ativos: "Ativos", inativos: "Inativos", online: "Com o app aberto", disponiveis: "Disponíveis", entregando: "Em entrega" } as const;
const COURIER_STATUS: Record<string, string> = { active: "Ativo", pending: "Esperando aprovação", blocked: "Bloqueado" };

export default function CouriersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Couriers searchParams={searchParams} />
    </Suspense>
  );
}

async function Couriers({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { cities, cityId, range, at } = await adminContext(params);
  const status = params.situacao && params.situacao in STATUSES ? (params.situacao as keyof typeof STATUSES) : "todos";
  const [data, report, roster] = await Promise.all([overview(range, cityId, at), couriersReport(range, cityId), courierRoster(cityId, status, at)]);
  const c = data.couriers;
  const here = (situacao: string) => withQuery("/admin/motoboys", { ...range.query, cidade: cityId, situacao: situacao === "todos" ? undefined : situacao });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Motoboys</h1>
      <RangeFilter path="/admin/motoboys" range={range} cities={cities} cityId={cityId} keep={{ situacao: status === "todos" ? undefined : status }} />

      <KpiGrid>
        <Kpi label="Rede do Chegô (cadastrados)" value={c.total} href={here("todos")} />
        <Kpi label="Ativos" value={c.active} href={here("ativos")} />
        <Kpi label="Inativos" value={c.inactive} href={here("inativos")} hint="Bloqueados ou esperando aprovação" />
        <Kpi label="Com o app aberto" value={c.online} href={here("online")} hint="Conexão: vistos nos últimos 5 minutos" />
        <Kpi label="Disponíveis" value={c.available} href={here("disponiveis")} hint="Marcados como disponíveis para receber entregas" />
        <Kpi label="Em entrega agora" value={c.delivering} href={here("entregando")} hint="Com pedido saindo para entrega (rede e lojas)" />
        <Kpi label="Entregas concluídas" value={report.delivered} hint="No período" />
        <Kpi label="Entregas canceladas" value={report.cancelled} hint="Pedidos com entregador cancelados no período" />
        <Kpi label="Tempo médio de entrega" value={report.avgMinutes === null ? "—" : `${report.avgMinutes} min`} hint="Da saída da loja até a entrega" />
        <Kpi label="Entregadores das lojas" value={c.storeCouriers} />
      </KpiGrid>
      <p className="text-xs text-coffee-soft">
        Estar com o app aberto não quer dizer estar disponível: o entregador marca a disponibilidade no app, e quem está levando um pedido aparece em “Em entrega”.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Entregas concluídas"><SeriesChart title="Entregas" points={report.series} kind="count" testId="chart-deliveries" /></Panel>
        <Panel title="Quem mais entregou">
          {report.ranking.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma entrega no período.</p>
            : <Bars rows={report.ranking.map((row) => ({ label: `${row.name}${row.kind === "loja" ? " (da loja)" : ""}${row.avgMinutes !== null ? ` · ${row.avgMinutes} min em média` : ""}`, value: row.deliveries,
                href: withQuery("/admin/pedidos", { ...range.query, cidade: cityId, motoboy: row.id }) }))} format={(value) => `${value} entrega${value === 1 ? "" : "s"}`} />}
        </Panel>
      </div>

      <Panel title={`Entregadores da rede · ${STATUSES[status]}`}>
        <nav aria-label="Situação" className="flex flex-wrap gap-1.5">
          {Object.entries(STATUSES).map(([key, label]) => (
            <Link key={key} href={here(key)} aria-current={key === status ? "true" : undefined}
              className={`flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-1 ${key === status ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach"}`}>{label}</Link>
          ))}
        </nav>
        {roster.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum entregador nessa situação.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Entregadores">
            <table className="w-full min-w-[640px] text-sm" data-testid="courier-roster">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Nome</th><th className="pr-2">Cidade</th><th className="pr-2">Cadastro</th><th className="pr-2">Conexão</th><th className="pr-2">Disponível</th><th>Em entrega</th></tr></thead>
              <tbody>
                {roster.map((row) => (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="py-1.5 pr-2 font-semibold">{row.name}<span className="block text-xs font-normal text-coffee-soft">{row.kind === "platform" ? "Do Chegô" : "Parceiro"}</span></td>
                    <td className="pr-2">{row.city}</td>
                    <td className="pr-2">{COURIER_STATUS[row.status] ?? row.status}</td>
                    <td className="pr-2">{row.online ? "● App aberto" : row.last_seen_at ? `Visto ${formatDateTime(row.last_seen_at)}` : "Nunca abriu"}</td>
                    <td className="pr-2">{row.status === "active" && row.available ? "Sim" : "Não"}</td>
                    <td>{row.delivering > 0 ? `${row.delivering} pedido${row.delivering > 1 ? "s" : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Link href="/admin/entregadores" className="text-sm font-bold text-brand-dark underline">Aprovar, bloquear e cadastrar entregadores</Link>
      </Panel>

      <Panel title="Atividade recente">
        {report.recent.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma entrega no período.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {report.recent.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-cream py-1">
                <span><Link href={`/admin/pedidos/${row.id}`} className="font-bold text-brand-dark underline">{row.code}</Link> · {row.courier} · {row.store}</span>
                <span className="text-coffee-soft">{STATUS_LABELS[row.status as OrderStatus]} · {formatDateTime(row.completed_at ?? row.dispatched_at ?? new Date())}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
