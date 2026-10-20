import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { businessDate } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { filtersToParams, loadReportOrders, parseReportFilters, reportNeighborhoods } from "@/lib/merchant/report-data";
import { pendingCents, receivedCents, SEGMENTS, segmentRows, type ReportOrder, type Segment } from "@/lib/merchant/report-rules";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { ReportFilterBar } from "../ReportFilterBar";

export const metadata: Metadata = { title: "Pedidos do relatório" };

type SearchParams = Promise<Record<string, string | undefined>>;
const PAGE_SIZE = 50;
const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;

export default function ReportOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando pedidos" />}>
      <ReportOrders searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportOrders({ searchParams }: { searchParams: SearchParams }) {
  const [params, { store, at }] = await Promise.all([searchParams, getMerchantContext("relatorios.ver")]);
  const filters = parseReportFilters(params, businessDate(at, 0));
  const segment: Segment = filters.segmento ?? "todos";
  const [orders, neighborhoods] = await Promise.all([loadReportOrders(store.id, filters), reportNeighborhoods(store.id)]);
  // As mesmas linhas e a mesma soma do indicador que trouxe a pessoa até aqui.
  const { rows, count, totalCents } = segmentRows(orders, segment, at);
  const info = SEGMENTS[segment];

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.pagina) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const back = `/lojista/relatorios${filtersToParams(filters)}`;
  const pageLink = (target: number) => `/lojista/relatorios/pedidos${filtersToParams(filters, { segmento: segment, pagina: target === 1 ? undefined : String(target) })}`;
  const receivables = segment === "a_receber" || segment === "recebidos";

  return (
    <div className="flex flex-col gap-4">
      <Link href={back} className="inline-flex min-h-11 items-center self-start font-semibold text-brand-dark">← Voltar ao relatório</Link>
      <header>
        <h1 className="text-3xl">{info.label}</h1>
        <p className="text-coffee-soft" data-testid="segment-total">
          {count === 1 ? "1 pedido" : `${count} pedidos`}
          {info.amount && <> · <strong className="text-coffee">{formatCents(totalCents)}</strong></>}
        </p>
      </header>

      <ReportFilterBar basePath="/lojista/relatorios/pedidos" filters={filters} neighborhoods={neighborhoods} segment={segment} showSearch />

      <nav aria-label="Ver outra lista" className="flex flex-wrap gap-2 text-sm">
        {(["todos", "vendidos", "concluidos", "andamento", "cancelados", "a_receber", "recebidos"] as Segment[]).map((key) => (
          <Link key={key} href={`/lojista/relatorios/pedidos${filtersToParams(filters, { segmento: key })}`} aria-current={key === segment ? "true" : undefined}
            className={`flex min-h-11 items-center rounded-full px-3 font-semibold ring-1 ${key === segment ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach hover:ring-brand"}`}>
            {SEGMENTS[key].label}
          </Link>
        ))}
      </nav>

      {count === 0 ? (
        <p role="status" className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">
          Nenhum pedido com esses filtros. <Link href={`/lojista/relatorios/pedidos?segmento=${segment}`} className="font-semibold text-brand-dark underline">Limpar filtros</Link>
        </p>
      ) : (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pedidos (role para o lado para ver tudo)">
            <table className="w-full min-w-[720px] text-sm" data-testid="report-orders">
              <thead>
                <tr className="text-left text-coffee-soft">
                  <th scope="col" className="py-1 pr-2">Pedido</th>
                  <th scope="col" className="pr-2">Data</th>
                  <th scope="col" className="pr-2">Cliente</th>
                  <th scope="col" className="pr-2">Situação</th>
                  <th scope="col" className="pr-2">Entrega</th>
                  <th scope="col" className="pr-2">Pagamento</th>
                  <th scope="col" className="pr-2 text-right">Total</th>
                  {receivables ? (
                    <>
                      <th scope="col" className="pr-2 text-right">Recebido</th>
                      <th scope="col" className="pr-2 text-right">A receber</th>
                      <th scope="col">Recebimento</th>
                    </>
                  ) : info.amount && segment !== "vendidos" && segment !== "concluidos" && segment !== "andamento" ? (
                    <th scope="col" className="text-right">{segment === "entrega" ? "Taxa de entrega" : segment === "descontos" ? "Desconto" : "Valor"}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((order) => (
                  <tr key={order.id} className="border-t border-cream" data-testid="report-order">
                    <td className="py-1 pr-2 font-semibold"><Link href={`/lojista/pedidos/${order.id}`} className="underline">{order.code}</Link></td>
                    <td className="pr-2">{formatDateTime(order.paidAt)}</td>
                    <td className="pr-2">{order.customerName}</td>
                    <td className="pr-2">{STATUS_LABELS[order.status as OrderStatus] ?? order.status}</td>
                    <td className="pr-2">{order.fulfillment === "pickup" ? "Retirada" : order.neighborhood ?? "Entrega"}</td>
                    <td className="pr-2">{PAYMENT[order.paymentMethod]}{order.collection === "app" ? " (app)" : ""}</td>
                    <td className="pr-2 text-right tabular-nums">{formatCents(order.totalCents - order.refundedCents)}</td>
                    {receivables ? (
                      <>
                        <td className="pr-2 text-right tabular-nums">{formatCents(receivedCents(order, at))}</td>
                        <td className="pr-2 text-right font-semibold tabular-nums">{formatCents(pendingCents(order, at))}</td>
                        <td>{receiptStatus(order, at)}</td>
                      </>
                    ) : info.amount && segment !== "vendidos" && segment !== "concluidos" && segment !== "andamento" ? (
                      <td className="text-right font-semibold tabular-nums">{formatCents(info.amount(order, at))}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Páginas" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {page > 1 && <Link href={pageLink(page - 1)} className="flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach">← Anterior</Link>}
              <span>Página {page} de {pages}</span>
              {page < pages && <Link href={pageLink(page + 1)} className="flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach">Próxima →</Link>}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function receiptStatus(order: ReportOrder, at: Date): string {
  if (order.collection === "app") return pendingCents(order, at) > 0 ? "Repasse a caminho" : "Repassado";
  if (pendingCents(order, at) > 0) return order.paymentMethod === "cash" ? "Dinheiro na entrega" : "Cartão na entrega";
  return receivedCents(order, at) > 0 ? "Recebido na entrega" : "—";
}
