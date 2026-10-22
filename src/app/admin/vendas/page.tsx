import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { Bars } from "@/components/ui/Stats";
import { adminContext } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { bucketSql, fillSeries, salesByStore, SOLD, type StoreSales } from "@/lib/admin/super";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Vendas e faturamento" };

type SearchParams = Promise<Record<string, string | undefined>>;

export default function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

const sum = (rows: StoreSales[], pick: (row: StoreSales) => number) => rows.reduce((total, row) => total + pick(row), 0);

async function Sales({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { cities, cityId, range } = await adminContext(params);
  const [current, previous, series] = await Promise.all([
    salesByStore(range, cityId),
    salesByStore(range.previous, cityId),
    sql<{ key: string; value: number }[]>`
      select ${bucketSql(range.bucket, "o.paid_at")} as key, sum(o.total_cents - o.refunded_cents)::bigint::int as value
      from orders o where ${SOLD} and o.paid_at >= ${range.from} and o.paid_at < ${range.to} ${cityId ? sql`and o.city_id = ${cityId}` : sql``} group by 1`,
  ]);
  const totals = (rows: StoreSales[]) => ({
    gross: sum(rows, (row) => row.gross_cents), discount: sum(rows, (row) => row.discount_cents), sales: sum(rows, (row) => row.sales_cents),
    refunded: sum(rows, (row) => row.refunded_cents), cancelled: sum(rows, (row) => row.cancelled_cents), net: sum(rows, (row) => row.store_net_cents),
    fee: sum(rows, (row) => row.fee_cents), commission: sum(rows, (row) => row.commission_cents), paid: sum(rows, (row) => row.fees_paid_cents),
    sold: sum(rows, (row) => row.sold), orders: sum(rows, (row) => row.orders),
  });
  const now = totals(current);
  const before = totals(previous);
  const ticket = (t: typeof now) => (t.sold === 0 ? 0 : Math.round(t.sales / t.sold));
  const ranked = current.filter((row) => row.sales_cents > 0).slice(0, 10);
  const ordersLink = (storeId: string) => withQuery("/admin/pedidos", { ...range.query, cidade: cityId, loja: storeId, grupo: "vendidos" });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Vendas e faturamento</h1>
      <RangeFilter path="/admin/vendas" range={range} cities={cities} cityId={cityId} />

      <Panel title="Todas as lojas">
        <KpiGrid>
          <Kpi label="Faturamento bruto" value={formatCents(now.gross)} current={now.gross} previous={before.gross} format={formatCents} hint="Produtos + entrega, antes dos descontos" />
          <Kpi label="(−) Descontos" value={formatCents(now.discount)} current={now.discount} previous={before.discount} format={formatCents} inverse />
          <Kpi label="Vendas (pago − reembolsado)" value={formatCents(now.sales)} current={now.sales} previous={before.sales} format={formatCents} testId="kpi-sales-total" />
          <Kpi label="Ticket médio" value={formatCents(ticket(now))} current={ticket(now)} previous={ticket(before)} format={formatCents} />
          <Kpi label="Reembolsado e estornado" value={formatCents(now.refunded)} current={now.refunded} previous={before.refunded} format={formatCents} inverse />
          <Kpi label="Valor de pedidos cancelados" value={formatCents(now.cancelled)} current={now.cancelled} previous={before.cancelled} format={formatCents} inverse hint="Recusados, cancelados, expirados e reembolsados por inteiro" />
          <Kpi label="Líquido das lojas" value={formatCents(now.net)} current={now.net} previous={before.net} format={formatCents} hint="Vendas − taxas e comissões do Chegô" />
          <Kpi label="Taxas e comissões do Chegô" value={formatCents(now.fee + now.commission)} current={now.fee + now.commission} previous={before.fee + before.commission} format={formatCents}
            hint={`Taxas por pedido ${formatCents(now.fee)} · comissões ${formatCents(now.commission)}`} />
          <Kpi label="Pago ao Chegô pelas lojas" value={formatCents(now.paid)} current={now.paid} previous={before.paid} format={formatCents} hint="Cobranças de taxa pagas no período" href="/admin/taxas" />
        </KpiGrid>
        <p className="text-xs text-coffee-soft">
          Pagando direto à loja, o dinheiro do cliente vai para a loja; o Chegô recebe só a taxa por pedido, que a loja paga no fechamento do expediente.
          Por isso “taxas geradas” e “pago ao Chegô” podem ser diferentes no mesmo período.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Evolução das vendas"><SeriesChart title="Vendas" points={fillSeries(range, series)} kind="money" /></Panel>
        <Panel title="Lojas que mais venderam">
          {ranked.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={ranked.map((row) => ({ label: row.name, value: row.sales_cents, href: ordersLink(row.id) }))} format={formatCents} />}
        </Panel>
      </div>

      <Panel title="Por loja">
        {current.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Vendas por loja (role para o lado para ver tudo)">
            <table className="w-full min-w-[1000px] text-sm" data-testid="sales-by-store">
              <thead>
                <tr className="text-left text-coffee-soft">
                  <th className="py-1 pr-2">Loja</th><th className="pr-2 text-right">Pedidos</th><th className="pr-2 text-right">Bruto</th><th className="pr-2 text-right">Descontos</th>
                  <th className="pr-2 text-right">Vendas</th><th className="pr-2 text-right">Ticket</th><th className="pr-2 text-right">Reembolsos</th><th className="pr-2 text-right">Cancelados</th>
                  <th className="pr-2 text-right">Líquido da loja</th><th className="pr-2 text-right">Taxas + comissões</th><th className="text-right">Pago ao Chegô</th>
                </tr>
              </thead>
              <tbody>
                {current.map((row) => {
                  const prev = previous.find((item) => item.id === row.id);
                  return (
                    <tr key={row.id} className="border-t border-cream">
                      <td className="py-1.5 pr-2"><Link href={`/admin/lojas/${row.id}`} className="font-semibold underline">{row.name}</Link>
                        {prev && <span className="block text-xs text-coffee-soft">antes: {formatCents(prev.sales_cents)}</span>}</td>
                      <td className="pr-2 text-right tabular-nums"><Link href={ordersLink(row.id)} className="underline">{row.sold}</Link><span className="text-coffee-soft"> / {row.orders}</span></td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.gross_cents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.discount_cents)}</td>
                      <td className="pr-2 text-right font-semibold tabular-nums">{formatCents(row.sales_cents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.sold === 0 ? 0 : Math.round(row.sales_cents / row.sold))}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.refunded_cents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.cancelled_cents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.store_net_cents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.fee_cents + row.commission_cents)}</td>
                      <td className="text-right tabular-nums">{formatCents(row.fees_paid_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-peach font-bold">
                  <td className="py-1.5 pr-2">Total</td><td className="pr-2 text-right tabular-nums">{now.sold} / {now.orders}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(now.gross)}</td><td className="pr-2 text-right tabular-nums">{formatCents(now.discount)}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(now.sales)}</td><td className="pr-2 text-right tabular-nums">{formatCents(ticket(now))}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(now.refunded)}</td><td className="pr-2 text-right tabular-nums">{formatCents(now.cancelled)}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(now.net)}</td><td className="pr-2 text-right tabular-nums">{formatCents(now.fee + now.commission)}</td>
                  <td className="text-right tabular-nums">{formatCents(now.paid)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-coffee-soft">Pedidos: vendidos / todos que foram pagos no período. Valores pela data do pagamento.</p>
      </Panel>
    </div>
  );
}
