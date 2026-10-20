import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Bars } from "@/components/ui/Stats";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { addDays, businessDate } from "@/lib/fees/rules";
import { formatCents } from "@/lib/format";
import { listAlerts, suggestions } from "@/lib/inventory/queries";
import { formatQuantity } from "@/lib/inventory/rules";
import { getMerchantContext } from "@/lib/merchant/context";
import { loadReportOrders, topProducts } from "@/lib/merchant/report-data";
import { change, isSold, summarize, type Change } from "@/lib/merchant/report-rules";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

export const metadata: Metadata = { title: "Resumo do dia" };

const IN_PROGRESS: OrderStatus[] = ["paid", "accepted", "preparing", "ready", "out_for_delivery"];
const box = "flex min-w-0 flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-peach";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando o resumo" />}>
      <Dashboard />
    </Suspense>
  );
}

function Delta({ value }: { value: Change }) {
  if (value.direction === "none" || value.direction === "new") return <span className="text-xs text-coffee-soft">sem vendas ontem até esta hora</span>;
  return (
    <span className={`text-xs font-bold ${value.direction === "same" ? "text-coffee-soft" : value.direction === "up" ? "text-success" : "text-danger"}`}>
      {value.direction === "up" ? "▲" : value.direction === "down" ? "▼" : "="} {value.pct!.toLocaleString("pt-BR")}% vs. ontem até esta hora
    </span>
  );
}

function Block({ title, href, linkLabel, children, testId }: { title: string; href?: string; linkLabel?: string; children: ReactNode; testId?: string }) {
  return (
    <section className={box} data-testid={testId}>
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg">{title}</h2>
        {href && <Link href={href} className="text-sm font-bold text-brand-dark underline">{linkLabel ?? "Ver tudo"}</Link>}
      </header>
      {children}
    </section>
  );
}

async function Dashboard() {
  const { membership, store, at } = await getMerchantContext("dashboard.ver");
  const may = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(membership, permission);
  const showSales = may("relatorios.ver") || may("financeiro.ver");
  const showStock = may("estoque.ver");
  const today = businessDate(at, 0);
  const yesterday = addDays(today, -1);
  const sameTimeYesterday = new Date(at.getTime() - 24 * 60 * 60 * 1000);

  const [todayOrders, yesterdayOrders, progress, alerts, restock, bills, couriers] = await Promise.all([
    showSales ? loadReportOrders(store.id, { preset: "hoje", from: today, to: today }) : [],
    showSales ? loadReportOrders(store.id, { preset: "ontem", from: yesterday, to: yesterday }) : [],
    may("pedidos.ver")
      ? sql<{ status: OrderStatus; count: number }[]>`select status, count(*)::int as count from orders where store_id = ${store.id} and status = any(${IN_PROGRESS}::order_status[]) group by status`
      : [],
    showStock ? listAlerts(store.id, false, 50) : [],
    showStock ? suggestions(store.id, at) : [],
    may("vendas.presenciais")
      ? sql<{ open: number; tables: number }[]>`
          select (select count(*)::int from table_bills where store_id = ${store.id} and status = 'aberta') as open,
                 (select count(*)::int from store_tables where store_id = ${store.id}) as tables`
      : [],
    may("entregadores.ver")
      ? sql<{ id: string; name: string; open: number }[]>`
          select p.id, p.full_name as name,
                 (select count(*)::int from orders o where o.store_id = m.store_id and o.courier_id = p.id and o.status = 'out_for_delivery') as open
          from store_members m join profiles p on p.id = m.profile_id
          where m.store_id = ${store.id} and m.role = 'courier' and m.active order by p.full_name`
      : [],
  ]);

  // Hoje contra ontem até o mesmo horário, pelas mesmas linhas dos relatórios.
  const summary = summarize(todayOrders, at);
  const before = summarize(yesterdayOrders.filter((order) => order.paidAt <= sameTimeYesterday), at);
  const top = showSales ? await topProducts(todayOrders.filter(isSold).map((order) => order.id), 5) : [];
  const inProgress = progress.reduce((sum, row) => sum + row.count, 0);
  const low = alerts.filter((alert) => alert.kind === "baixo");
  const expiring = alerts.filter((alert) => alert.kind === "vencendo" || alert.kind === "vencido");
  const toBuy = restock.filter((item) => item.suggested > 0);

  const shortcuts = [
    { href: "/lojista/pedidos", label: "Pedidos", ok: may("pedidos.ver") },
    { href: "/lojista/mesas", label: "Mesas e balcão", ok: may("vendas.presenciais") },
    { href: "/lojista/cardapio", label: "Cardápio", ok: may("produtos.ver") },
    { href: "/lojista/estoque", label: "Estoque", ok: showStock },
    { href: "/lojista/relatorios?periodo=hoje", label: "Relatório de hoje", ok: may("relatorios.ver") },
    { href: "/lojista/financeiro", label: "Fechamento de caixa", ok: may("financeiro.ver") },
  ].filter((item) => item.ok);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Resumo do dia</h1>
        <p className="text-coffee-soft">{store.name} · o que importa agora, num lugar só.</p>
      </header>

      {shortcuts.length > 0 && (
        <nav aria-label="Atalhos" className="flex flex-wrap gap-2">
          {shortcuts.map((item) => (
            <Link key={item.href} href={item.href} className="flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-peach hover:ring-brand-dark">{item.label}</Link>
          ))}
        </nav>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showSales && (
          <Link href="/lojista/relatorios?periodo=hoje&segmento=vendidos" className={`${box} hover:ring-2 hover:ring-brand-dark`} data-testid="dash-sales">
            <p className="text-sm text-coffee-soft">Vendido hoje</p>
            <p className="font-display text-2xl font-semibold">{formatCents(summary.sold.totalCents)}</p>
            <p className="text-xs text-coffee-soft">{summary.sold.count} pedido{summary.sold.count === 1 ? "" : "s"} · ticket médio {formatCents(summary.ticketCents)}</p>
            <Delta value={change(summary.sold.totalCents, before.sold.totalCents)} />
          </Link>
        )}
        {may("pedidos.ver") && (
          <Link href="/lojista/pedidos" className={`${box} hover:ring-2 hover:ring-brand-dark`} data-testid="dash-progress">
            <p className="text-sm text-coffee-soft">Pedidos em andamento</p>
            <p className="font-display text-2xl font-semibold">{inProgress}</p>
            <p className="text-xs text-coffee-soft">
              {progress.length === 0 ? "Nenhum agora." : progress.map((row) => `${row.count} ${STATUS_LABELS[row.status].toLowerCase()}`).join(" · ")}
            </p>
          </Link>
        )}
        {bills.length > 0 && (
          <Link href="/lojista/mesas" className={`${box} hover:ring-2 hover:ring-brand-dark`} data-testid="dash-tables">
            <p className="text-sm text-coffee-soft">Mesas e balcão</p>
            <p className="font-display text-2xl font-semibold">{bills[0].open} conta{bills[0].open === 1 ? "" : "s"} aberta{bills[0].open === 1 ? "" : "s"}</p>
            <p className="text-xs text-coffee-soft">{bills[0].tables} mesa{bills[0].tables === 1 ? "" : "s"} cadastrada{bills[0].tables === 1 ? "" : "s"}</p>
          </Link>
        )}
        {may("entregadores.ver") && (
          <Link href="/lojista/entregadores" className={`${box} hover:ring-2 hover:ring-brand-dark`} data-testid="dash-couriers">
            <p className="text-sm text-coffee-soft">Entregadores ativos</p>
            <p className="font-display text-2xl font-semibold">{couriers.length}</p>
            <p className="text-xs text-coffee-soft">{couriers.filter((courier) => courier.open > 0).length} em rota agora</p>
          </Link>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {showSales && (
          <Block title="Mais vendidos hoje" href="/lojista/relatorios?periodo=hoje" linkLabel="Relatório" testId="dash-top">
            {top.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma venda hoje ainda.</p> : (
              <Bars rows={top.map((row) => ({ label: row.name, value: row.quantity }))} format={(value) => `${value} vendido${value === 1 ? "" : "s"}`} />
            )}
          </Block>
        )}
        {showStock && (
          <Block title="Estoque baixo" href="/lojista/estoque/alertas" testId="dash-low">
            {low.length === 0 ? <p className="text-sm text-coffee-soft">Nada abaixo do mínimo.</p> : (
              <ul className="flex flex-col gap-1 text-sm">
                {low.slice(0, 6).map((alert) => (
                  <li key={alert.id} className="flex justify-between gap-2">
                    <Link href={`/lojista/estoque/${alert.itemId}`} className="underline">{alert.itemName}</Link>
                    <span className="font-semibold tabular-nums text-danger">{formatQuantity(alert.quantity, alert.unit)} <span className="font-normal text-coffee-soft">(mín. {formatQuantity(alert.minQuantity, alert.unit)})</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}
        {showStock && (
          <Block title="Validade" href="/lojista/estoque/validade" testId="dash-expiry">
            {expiring.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum lote vencendo.</p> : (
              <ul className="flex flex-col gap-1 text-sm">
                {expiring.slice(0, 6).map((alert) => (
                  <li key={alert.id} className="flex justify-between gap-2">
                    <Link href={`/lojista/estoque/${alert.itemId}`} className="underline">{alert.itemName}</Link>
                    <span className={alert.kind === "vencido" ? "font-semibold text-danger" : "text-coffee-soft"}>{alert.kind === "vencido" ? "Vencido" : "Vencendo"}{alert.detail ? ` · ${alert.detail}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}
        {showStock && (
          <Block title="Reposição sugerida" href="/lojista/estoque/reposicao" linkLabel="Montar lista" testId="dash-restock">
            {toBuy.length === 0 ? <p className="text-sm text-coffee-soft">Nada para repor nos próximos 7 dias.</p> : (
              <ul className="flex flex-col gap-1 text-sm">
                {toBuy.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>{item.name}</span>
                    <span className="font-semibold tabular-nums">comprar {formatQuantity(item.suggested, item.unit)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}
      </div>
    </div>
  );
}
