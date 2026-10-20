import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Bars } from "@/components/ui/Stats";
import { hasPermission } from "@/lib/auth/session";
import { businessDate } from "@/lib/fees/rules";
import { formatCents } from "@/lib/format";
import { getMerchantContext, getTeam } from "@/lib/merchant/context";
import { filtersToParams, loadReportOrders, MODALITIES, parseReportFilters, reportNeighborhoods, topProducts, type ReportFilters } from "@/lib/merchant/report-data";
import { change, financials, isSold, previousPeriod, summarize, type Change, type Segment } from "@/lib/merchant/report-rules";
import { ReportFilterBar } from "./ReportFilterBar";

export const metadata: Metadata = { title: "Relatórios" };

type SearchParams = Promise<Record<string, string | undefined>>;
const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando relatórios" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

/** Seta e percentual da comparação; sem base no período anterior, diz isso em vez de inventar um número. */
function Delta({ value, inverse = false }: { value: Change; inverse?: boolean }) {
  if (value.direction === "none") return <span className="text-xs text-coffee-soft">sem dados nos dois períodos</span>;
  if (value.direction === "new") return <span className="text-xs text-coffee-soft">sem base no período anterior</span>;
  const good = value.direction === "same" ? null : (value.direction === "up") !== inverse;
  return (
    <span className={`text-xs font-bold ${good === null ? "text-coffee-soft" : good ? "text-success" : "text-danger"}`} data-testid="delta">
      {value.direction === "up" ? "▲" : value.direction === "down" ? "▼" : "="} {value.pct!.toLocaleString("pt-BR")}%
    </span>
  );
}

function Card({ label, value, hint, href, delta, previous }: { label: string; value: ReactNode; hint?: string; href?: string; delta?: ReactNode; previous?: string }) {
  const content = (
    <>
      <p className="text-sm text-coffee-soft">{label}</p>
      <p className="font-display text-2xl font-semibold break-words">{value}</p>
      {delta && <p className="flex flex-wrap items-baseline gap-x-2">{delta}{previous && <span className="text-xs text-coffee-soft">antes: {previous}</span>}</p>}
      {hint && <p className="text-xs text-coffee-soft">{hint}</p>}
      {href && <p className="mt-1 text-xs font-bold text-brand-dark underline">Ver detalhes</p>}
    </>
  );
  const box = "block h-full min-w-0 rounded-card bg-white p-4 ring-1 ring-peach";
  return href
    ? <Link href={href} data-testid="stat" className={`${box} transition-shadow hover:ring-2 hover:ring-brand-dark`}>{content}</Link>
    : <div data-testid="stat" className={box}>{content}</div>;
}

async function Reports({ searchParams }: { searchParams: SearchParams }) {
  const [params, { membership, store, at }] = await Promise.all([searchParams, getMerchantContext("relatorios.ver")]);
  // "Hoje" segue o calendário de Maceió (meia-noite a meia-noite).
  const today = businessDate(at, 0);
  const filters = parseReportFilters(params, today);
  const compare = params.comparar !== "0";
  const prev = previousPeriod(filters.from, filters.to, filters.preset);
  const canMoney = hasPermission(membership, "financeiro.ver");
  const [orders, before, neighborhoods, team] = await Promise.all([
    loadReportOrders(store.id, filters),
    compare ? loadReportOrders(store.id, { ...filters, preset: "personalizado", from: prev.from, to: prev.to }) : Promise.resolve([]),
    reportNeighborhoods(store.id),
    hasPermission(membership, "equipe.gerenciar") ? getTeam(store.id) : Promise.resolve([]),
  ]);
  const summary = summarize(orders, at);
  const prevSummary = summarize(before, at);
  const money = financials(orders);
  const prevMoney = financials(before);
  const products = await topProducts(orders.filter(isSold).map((order) => order.id));

  // Todo link leva os filtros atuais junto: a listagem mostra exatamente as linhas somadas aqui.
  const list = (segment: Segment, patch: Partial<ReportFilters> = {}) =>
    `/lojista/relatorios/pedidos${filtersToParams({ ...filters, ...patch }, { segmento: segment })}`;
  const count = (value: number) => (value === 1 ? "1 pedido" : `${value} pedidos`);
  const cmp = (current: number, previous: number, inverse = false) => (compare ? <Delta value={change(current, previous)} inverse={inverse} /> : undefined);
  const brDate = (value: string) => value.split("-").reverse().join("/");

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl">Relatórios</h1>
        <nav aria-label="Outros relatórios" className="flex flex-wrap gap-2">
          <Link href={`/lojista/relatorios/balancete${filtersToParams(filters)}`} className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Balancete</Link>
          <Link href="/lojista/relatorios/anual" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Relatório anual</Link>
          {hasPermission(membership, "relatorios.exportar") && (
            <a href={`/lojista/relatorios/exportar${filtersToParams(filters)}`} download className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Baixar CSV</a>
          )}
        </nav>
      </header>

      <ReportFilterBar basePath="/lojista/relatorios" filters={filters} neighborhoods={neighborhoods} staff={team.filter((person) => person.role !== "courier").map((person) => ({ id: person.id, name: person.name || "Sem nome" }))} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {compare
          ? <span>Comparando com <strong>{prev.label}</strong> ({brDate(prev.from)}{prev.to !== prev.from && ` a ${brDate(prev.to)}`}).</span>
          : <span>Sem comparação.</span>}
        <Link href={`/lojista/relatorios${filtersToParams(filters, { comparar: compare ? "0" : undefined })}`} className="font-semibold text-brand-dark underline">
          {compare ? "Tirar a comparação" : "Comparar com o período anterior"}
        </Link>
      </div>

      {orders.length === 0 && (
        <p role="status" className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum pedido com esses filtros. Tente outro período ou limpe os filtros.</p>
      )}

      <p className="text-sm text-coffee-soft">Toque em um número para ver os pedidos que formam ele.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="report-stats">
        <Card label="Pedidos" value={summary.sold.count} hint="vendidos (sem recusados e cancelados)" href={list("vendidos")} delta={cmp(summary.sold.count, prevSummary.sold.count)} previous={compare ? String(prevSummary.sold.count) : undefined} />
        <Card label="Vendas" value={formatCents(summary.sold.totalCents)} hint="já sem descontos e reembolsos" href={list("vendidos")} delta={cmp(summary.sold.totalCents, prevSummary.sold.totalCents)} previous={compare ? formatCents(prevSummary.sold.totalCents) : undefined} />
        <Card label="Ticket médio" value={formatCents(summary.ticketCents)} hint="vendas ÷ pedidos" href={list("vendidos")} delta={cmp(summary.ticketCents, prevSummary.ticketCents)} />
        <Card label="Itens vendidos" value={money.itemsSold} href={list("vendidos")} delta={cmp(money.itemsSold, prevMoney.itemsSold)} />
        <Card label="Pedidos recebidos" value={summary.receivedOrders} hint="todos, inclusive recusados" href={list("todos")} delta={cmp(summary.receivedOrders, prevSummary.receivedOrders)} />
        <Card label="Concluídos" value={summary.completed.count} hint={formatCents(summary.completed.totalCents)} href={list("concluidos")} delta={cmp(summary.completed.count, prevSummary.completed.count)} />
        <Card label="Em andamento" value={summary.inProgress.count} hint={formatCents(summary.inProgress.totalCents)} href={list("andamento")} />
        <Card label="Recusados e cancelados" value={summary.cancelled.count} hint={`${(summary.refusalRate * 100).toFixed(1).replace(".", ",")}% dos pedidos recebidos`} href={list("cancelados")} delta={cmp(summary.cancelled.count, prevSummary.cancelled.count, true)} />
        <Card label="A receber" value={formatCents(summary.pending.totalCents)} hint={count(summary.pending.count)} href={list("a_receber")} />
        <Card label="Já recebido" value={formatCents(summary.received.totalCents)} hint={count(summary.received.count)} href={list("recebidos")} />
        <Card label="Taxas de entrega" value={formatCents(summary.deliveryFees.totalCents)} hint={count(summary.deliveryFees.count)} href={list("entrega")} />
        <Card label="Descontos" value={formatCents(summary.discounts.totalCents)} hint={count(summary.discounts.count)} href={list("descontos")} delta={cmp(summary.discounts.totalCents, prevSummary.discounts.totalCents, true)} />
        <Card label="Estornos e reembolsos" value={formatCents(money.refundCents)} href={list("estornos")} delta={cmp(money.refundCents, prevMoney.refundCents, true)} />
        {/* Médias de tempo não têm uma lista própria: não são clicáveis. */}
        <Card label="Tempo médio de aceite" value={summary.avgAcceptMinutes === null ? "—" : `${summary.avgAcceptMinutes} min`} />
        <Card label="Tempo médio de preparo" value={summary.avgPrepMinutes === null ? "—" : `${summary.avgPrepMinutes} min`} />
      </div>

      {canMoney && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach" aria-labelledby="money" data-testid="financials">
          <h2 id="money" className="mb-2 text-xl">Resultado do período</h2>
          <dl className="grid gap-x-6 text-sm sm:grid-cols-2">
            {([
              ["Faturamento bruto", money.grossCents, "produtos + entrega dos pedidos vendidos, antes dos descontos", prevMoney.grossCents],
              ["(−) Descontos", money.discountCents, "cupons e descontos aplicados", prevMoney.discountCents],
              ["(−) Estornos e reembolsos", money.refundCents, "devolvidos aos clientes", prevMoney.refundCents],
              ["= Vendas", money.salesCents, "o que os clientes pagaram", prevMoney.salesCents],
              ["(−) Taxas do Chegô", money.platformFeeCents, "R$ 0,50 por pedido concluído", prevMoney.platformFeeCents],
              ["= Receita líquida operacional", money.netOperatingCents, "vendas − taxas do Chegô. Não é lucro: não desconta custos, salários nem impostos.", prevMoney.netOperatingCents],
            ] as [string, number, string, number][]).map(([label, value, help, previous]) => (
              <div key={label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-cream py-2">
                <dt className={label.startsWith("=") ? "font-bold" : ""}>{label}</dt>
                <dd className={`tabular-nums ${label.startsWith("=") ? "font-bold" : ""}`}>{formatCents(value)}</dd>
                <dd className="col-span-2 flex flex-wrap justify-between gap-2 text-xs text-coffee-soft">{help}{compare && <Delta value={change(value, previous)} inverse={label.startsWith("(−)")} />}</dd>
              </div>
            ))}
          </dl>
          {money.costCents !== null ? (
            <p className="mt-3 text-sm">
              Custo estimado dos produtos: <strong>{formatCents(money.costCents)}</strong> · margem estimada <strong>{formatCents(money.marginCents!)}</strong>
              <span className="block text-xs text-coffee-soft">Pelas saídas de estoque dos pedidos (vendas e fichas técnicas) × custo cadastrado de cada item. Só entram os pedidos com custo conhecido.</span>
            </p>
          ) : (
            <p className="mt-3 text-xs text-coffee-soft">Cadastre o custo dos itens no Estoque e as fichas técnicas para ver o custo e a margem estimada.</p>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Produtos mais vendidos</h2>
          {products.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={products.map((product) => ({ label: product.name, value: product.quantity, href: list("vendidos", { produto: product.name }) }))} format={(value) => `${value} un.`} />}
        </section>

        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Formas de pagamento e canais</h2>
          {money.byPayment.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p> : (
            <>
              <Bars rows={money.byPayment.map((row) => ({ label: `${PAYMENT[row.method]} (${row.count})`, value: row.totalCents, href: list("vendidos", { pagamento: row.method }) }))} format={formatCents} />
              <h3 className="mb-2 mt-4 font-sans text-sm font-bold uppercase text-coffee-soft">Por canal</h3>
              <Bars rows={money.byChannel.map((row) => ({ label: `${MODALITIES[row.channel as keyof typeof MODALITIES] ?? row.channel} (${row.count})`, value: row.totalCents, href: list("vendidos", { modalidade: row.channel as keyof typeof MODALITIES }) }))} format={formatCents} />
            </>
          )}
        </section>

        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Horários de pico</h2>
          {summary.byHour.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={summary.byHour.map((row) => ({ label: `${row.hour}h`, value: row.count, href: list("vendidos", { hora: row.hour }) }))} format={(value) => `${value} ped.`} />}
        </section>

        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Vendas por dia</h2>
          {summary.byDay.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={summary.byDay.slice(-31).map((row) => ({
                label: row.day.split("-").reverse().slice(0, 2).join("/"), value: row.totalCents,
                href: list("vendidos", { preset: "personalizado", from: row.day, to: row.day }),
              }))} format={formatCents} />}
        </section>
      </div>
    </div>
  );
}
