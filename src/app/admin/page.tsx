import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { adminContext } from "@/lib/admin/page";
import { overview } from "@/lib/admin/super";
import { withQuery } from "@/lib/admin/period";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { storeAvailability, type Shift } from "@/lib/stores/hours";

export const metadata: Metadata = { title: "Painel do admin" };

type SearchParams = Promise<Record<string, string | undefined>>;

export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando o painel" />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { profile, superAdmin, at, cities, cityId, range } = await adminContext(params);

  const [data, [alerts], storeRows] = await Promise.all([
    overview(range, cityId, at),
    sql<{ pending: number; tickets: number }[]>`
      select (select count(*)::int from stores where status = 'pending' and closed_at is null) as pending,
             (select count(*)::int from support_tickets where status <> 'resolved') as tickets`,
    sql<{ status: "active" | "paused"; manual_state: "auto" | "open" | "closed"; paused_until: Date | null; shifts: Shift[] }[]>`
      select s.status, s.manual_state, s.paused_until,
             coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text))
                       from store_hours h where h.store_id = s.id), '[]') as shifts
      from stores s where s.status in ('active', 'paused') and s.closed_at is null ${cityId ? sql`and s.city_id = ${cityId}` : sql``}`,
  ]);
  const openNow = storeRows.filter((store) =>
    storeAvailability({ status: store.status, manualState: store.manual_state, pausedUntil: store.paused_until, shifts: store.shifts, closures: [] }, at).state === "open").length;

  // Cada número abre a lista que o explica, com o mesmo período e a mesma cidade.
  const cut = { ...range.query, cidade: cityId };
  const to = (path: string, extra: Record<string, string> = {}) => withQuery(path, { ...cut, ...extra });
  const { orders, sales } = data;
  const revenue = (pick: "current" | "previous") => sales.feeCents[pick] + sales.commissionCents[pick] + sales.adsRevenueCents[pick];
  const ticket = (pick: "current" | "previous") => (sales.sold[pick] === 0 ? 0 : Math.round(sales.gmvCents[pick] / sales.sold[pick]));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl">Oi, {profile.fullName}!</h1>
        <p className="text-coffee-soft">{superAdmin ? "Super admin: você controla toda a operação." : "Admin: você vê o painel; as ações globais críticas são do super admin."}</p>
      </header>

      {params.negado === "1" && (
        <p role="alert" className="rounded-2xl bg-peach px-4 py-3 font-semibold">Essa ação é só do super admin. A tentativa ficou registrada na auditoria.</p>
      )}
      {(alerts.pending > 0 || alerts.tickets > 0) && (
        <div className="flex flex-wrap gap-2">
          {alerts.pending > 0 && (
            <Link href="/admin/lojas?situacao=pending" className="rounded-full bg-brand px-4 py-2 font-bold text-coffee">
              {alerts.pending} loja{alerts.pending > 1 ? "s" : ""} esperando aprovação
            </Link>
          )}
          {alerts.tickets > 0 && (
            <Link href="/admin/suporte" className="rounded-full bg-peach px-4 py-2 font-bold">
              {alerts.tickets} chamado{alerts.tickets > 1 ? "s" : ""} de suporte em aberto
            </Link>
          )}
        </div>
      )}

      <RangeFilter path="/admin" range={range} cities={cities} cityId={cityId} />

      <Panel title="Lojas e empresas">
        <KpiGrid>
          <Kpi label="Lojas cadastradas" value={data.stores.total} href="/admin/lojas" hint="Sem contar as excluídas" />
          <Kpi label="Ativas" value={data.stores.active} href="/admin/lojas?situacao=active" />
          <Kpi label="Lojas abertas agora" value={`${openNow} de ${data.stores.active + data.stores.inactive}`} href={withQuery("/admin/lojas", { cidade: cityId, abertas: "1" })} />
          <Kpi label="Inativas (desativadas)" value={data.stores.inactive} href="/admin/lojas?situacao=paused" />
          <Kpi label="Suspensas" value={data.stores.suspended} href="/admin/suspensas" />
          <Kpi label="Pendentes de aprovação" value={data.stores.pending} href="/admin/lojas?situacao=pending" />
          <Kpi label="Novas lojas no período" value={data.storesNew.current} current={data.storesNew.current} previous={data.storesNew.previous} href={to("/admin/relatorios")} />
          <Kpi label="Lojas excluídas (total)" value={data.stores.closed} href="/admin/excluidas" />
          <Kpi label="Empresas cadastradas" value={data.companies.total} href="/admin/empresas" hint="Responsáveis com loja no Chegô" />
          <Kpi label="Novas empresas no período" value={data.companiesNew.current} current={data.companiesNew.current} previous={data.companiesNew.previous} href={to("/admin/relatorios")} />
          <Kpi label="Empresas que excluíram a conta" value={data.companiesClosed.current} current={data.companiesClosed.current} previous={data.companiesClosed.previous} inverse
            hint={`${data.companies.closedByCompany} no total`} href="/admin/excluidas?por=empresa" />
        </KpiGrid>
      </Panel>

      <Panel title="Pedidos" action={<Link href={to("/admin/pedidos")} className="text-sm font-bold text-brand-dark underline">Ver pedidos</Link>}>
        <KpiGrid>
          <Kpi label="Pedidos realizados" value={orders.total.current} current={orders.total.current} previous={orders.total.previous} href={to("/admin/pedidos")} testId="kpi-orders" />
          <Kpi label="Concluídos" value={orders.done.current} current={orders.done.current} previous={orders.done.previous} href={to("/admin/pedidos", { grupo: "concluidos" })} />
          <Kpi label="Cancelados e recusados" value={orders.cancelled.current} current={orders.cancelled.current} previous={orders.cancelled.previous} inverse href={to("/admin/pedidos", { grupo: "cancelados" })} />
          <Kpi label="Em andamento" value={orders.progress.current} current={orders.progress.current} previous={orders.progress.previous} href={to("/admin/pedidos", { grupo: "andamento" })} />
          <Kpi label="Aguardando pagamento" value={orders.pending.current} current={orders.pending.current} previous={orders.pending.previous} href={to("/admin/pedidos", { grupo: "pendentes" })} />
        </KpiGrid>
        <SeriesChart title="Pedidos realizados" points={data.ordersSeries} kind="count" testId="chart-orders" />
      </Panel>

      <Panel title="Vendas e receita da plataforma" action={<Link href={to("/admin/vendas")} className="text-sm font-bold text-brand-dark underline">Ver por loja</Link>}>
        <KpiGrid>
          <Kpi label="Faturamento bruto das lojas" value={formatCents(sales.grossCents.current)} current={sales.grossCents.current} previous={sales.grossCents.previous} format={formatCents}
            hint="Produtos + entrega dos pedidos vendidos, antes de descontos" href={to("/admin/vendas")} />
          <Kpi label="Vendas realizadas" value={formatCents(sales.gmvCents.current)} current={sales.gmvCents.current} previous={sales.gmvCents.previous} format={formatCents}
            hint="O que os clientes pagaram, menos reembolsos" href={to("/admin/vendas")} testId="kpi-sales" />
          <Kpi label="Ticket médio" value={formatCents(ticket("current"))} current={ticket("current")} previous={ticket("previous")} format={formatCents} />
          <Kpi label="Receita da plataforma" value={formatCents(revenue("current"))} current={revenue("current")} previous={revenue("previous")} format={formatCents}
            hint="Taxas por pedido + comissões + anúncios" href={to("/admin/vendas")} testId="kpi-revenue" />
          <Kpi label="Taxas por pedido (R$ 0,50)" value={formatCents(sales.feeCents.current)} current={sales.feeCents.current} previous={sales.feeCents.previous} format={formatCents} href="/admin/taxas" />
          <Kpi label="Comissões (pagos pelo app)" value={formatCents(sales.commissionCents.current)} current={sales.commissionCents.current} previous={sales.commissionCents.previous} format={formatCents} />
          <Kpi label="Receita de anúncios" value={formatCents(sales.adsRevenueCents.current)} current={sales.adsRevenueCents.current} previous={sales.adsRevenueCents.previous} format={formatCents}
            hint="Valor das campanhas criadas no período" href={to("/admin/anuncios")} />
          <Kpi label="Anúncios no ar agora" value={data.ads.live} hint={`${data.ads.campaigns.current} campanha(s) criada(s) no período`} href="/admin/anuncios" />
        </KpiGrid>
        <SeriesChart title="Vendas realizadas" points={data.salesSeries} kind="money" testId="chart-sales" />
      </Panel>

      <Panel title="Motoboys" action={<Link href={to("/admin/motoboys")} className="text-sm font-bold text-brand-dark underline">Ver motoboys</Link>}>
        <KpiGrid>
          <Kpi label="Rede do Chegô (cadastrados)" value={data.couriers.total} href="/admin/motoboys" />
          <Kpi label="Ativos" value={data.couriers.active} href="/admin/motoboys?situacao=ativos" />
          <Kpi label="Inativos" value={data.couriers.inactive} hint="Bloqueados ou esperando aprovação" href="/admin/motoboys?situacao=inativos" />
          <Kpi label="Com o app aberto" value={data.couriers.online} hint="Vistos nos últimos 5 minutos" href="/admin/motoboys?situacao=online" />
          <Kpi label="Disponíveis para entregas" value={data.couriers.available} hint="Ativos e marcados como disponíveis" href="/admin/motoboys?situacao=disponiveis" />
          <Kpi label="Em entrega agora" value={data.couriers.delivering} hint="Com pedido saindo para entrega" href="/admin/motoboys?situacao=entregando" />
          <Kpi label="Entregadores das lojas" value={data.couriers.storeCouriers} hint="Cadastrados pelas próprias lojas" />
        </KpiGrid>
      </Panel>
    </div>
  );
}
