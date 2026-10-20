import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { businessDate } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";
import { MOVEMENT_LABELS, type MovementKind } from "@/lib/inventory/rules";
import { getMerchantContext } from "@/lib/merchant/context";
import { filtersToParams, loadReportOrders, MODALITIES, parseReportFilters, reportNeighborhoods } from "@/lib/merchant/report-data";
import { financials, isSold, saleCents, type ReportOrder } from "@/lib/merchant/report-rules";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { ReportFilterBar } from "../ReportFilterBar";

export const metadata: Metadata = { title: "Balancete" };

type SearchParams = Promise<Record<string, string | undefined>>;
const GROUPS = { dia: "Por dia", semana: "Por semana", mes: "Por mês", ano: "Por ano" } as const;
type Group = keyof typeof GROUPS;
const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;
const DETAIL_LIMIT = 100;

/** Início do grupo (dia, segunda-feira da semana, dia 1 do mês, 1º de janeiro) de uma data local. */
function groupStart(day: string, group: Group): string {
  if (group === "dia") return day;
  if (group === "mes") return `${day.slice(0, 7)}-01`;
  if (group === "ano") return `${day.slice(0, 4)}-01-01`;
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - weekday * 86_400_000).toISOString().slice(0, 10);
}
function groupEnd(start: string, group: Group): string {
  const date = new Date(`${start}T12:00:00Z`);
  if (group === "dia") return start;
  if (group === "semana") return new Date(date.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  if (group === "mes") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return `${start.slice(0, 4)}-12-31`;
}
const localDay = (date: Date) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
const br = (value: string) => value.split("-").reverse().join("/");

export default function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando balancete" />}>
      <Ledger searchParams={searchParams} />
    </Suspense>
  );
}

async function Ledger({ searchParams }: { searchParams: SearchParams }) {
  const [params, { membership, store, at }] = await Promise.all([searchParams, getMerchantContext("relatorios.ver")]);
  const filters = parseReportFilters(params, businessDate(at, 0));
  const group: Group = params.agrupar && params.agrupar in GROUPS ? (params.agrupar as Group) : "dia";
  const [orders, neighborhoods] = await Promise.all([loadReportOrders(store.id, filters), reportNeighborhoods(store.id)]);
  const canMoney = hasPermission(membership, "financeiro.ver");
  const showCustomer = hasPermission(membership, "clientes.ver");

  const buckets = new Map<string, ReportOrder[]>();
  for (const order of orders) {
    const start = groupStart(localDay(order.paidAt), group);
    buckets.set(start, [...(buckets.get(start) ?? []), order]);
  }
  const rows = [...buckets.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([start, list]) => ({ start, end: groupEnd(start, group), list, money: financials(list) }));
  const total = financials(orders);

  // Detalhe dos pedidos mais recentes: itens e movimentações de estoque ligadas a cada um.
  const detailed = orders.slice(0, DETAIL_LIMIT);
  const ids = detailed.map((order) => order.id);
  const [items, movements] = ids.length === 0 ? [[], []] : await Promise.all([
    sql<{ order_id: string; name: string; quantity: number; line_total_cents: number }[]>`
      select order_id, name, quantity, line_total_cents from order_items where order_id = any(${ids}::uuid[]) and removed_at is null order by order_id`,
    sql<{ order_id: string; item_name: string; kind: MovementKind; quantity: string }[]>`
      select coalesce(m.order_id, b.order_id) as order_id, i.name as item_name, m.kind, m.quantity::text
      from stock_movements m join stock_items i on i.id = m.item_id
      left join table_bill_items bi on bi.id = m.bill_item_id left join table_bills b on b.id = bi.bill_id
      where m.order_id = any(${ids}::uuid[]) or b.order_id = any(${ids}::uuid[]) order by m.created_at`,
  ]);
  const customers = showCustomer && ids.length > 0
    ? new Map((await sql<{ id: string; customer_name: string }[]>`select id, customer_name from orders where id = any(${ids}::uuid[])`).map((row) => [row.id, row.customer_name]))
    : new Map<string, string>();

  const listLink = (from: string, to: string) => `/lojista/relatorios/pedidos${filtersToParams({ ...filters, preset: "personalizado", from, to }, { segmento: "todos" })}`;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/lojista/relatorios${filtersToParams(filters)}`} className="inline-flex min-h-11 items-center self-start font-semibold text-brand-dark">← Voltar ao relatório</Link>
      <header>
        <h1 className="text-3xl">Balancete de pedidos</h1>
        <p className="text-coffee-soft">
          Vendas e saídas por período. Dinheiro e estoque aparecem separados: as colunas em R$ são valores dos pedidos; as movimentações de estoque estão
          no detalhe de cada pedido. Toque num período para ver os pedidos que formam o total.
        </p>
      </header>
      <ReportFilterBar basePath="/lojista/relatorios/balancete" filters={filters} neighborhoods={neighborhoods} />
      <nav aria-label="Agrupar" className="flex flex-wrap gap-2">
        {(Object.keys(GROUPS) as Group[]).map((key) => (
          <Link key={key} href={`/lojista/relatorios/balancete${filtersToParams(filters, { agrupar: key === "dia" ? undefined : key })}`} aria-current={group === key ? "true" : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-sm font-bold ring-1 ${group === key ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach"}`}>{GROUPS[key]}</Link>
        ))}
      </nav>

      {orders.length === 0 ? <p role="status" className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum pedido com esses filtros.</p> : (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Totais por período">
            <table className="w-full min-w-[860px] text-sm" data-testid="ledger">
              <thead><tr className="text-left text-coffee-soft">
                <th className="py-1 pr-2">Período</th><th className="pr-2 text-right">Pedidos</th><th className="pr-2 text-right">Vendidos</th>
                {canMoney && <><th className="pr-2 text-right">Bruto</th><th className="pr-2 text-right">Descontos</th><th className="pr-2 text-right">Entrega</th>
                  <th className="pr-2 text-right">Estornos</th><th className="pr-2 text-right">Vendas</th><th className="pr-2 text-right">Taxa Chegô</th><th className="text-right">Custo est.</th></>}
              </tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.start} className="border-t border-cream" data-testid="ledger-row">
                    <td className="py-1 pr-2"><Link href={listLink(row.start, row.end)} className="font-semibold underline">{group === "dia" ? br(row.start) : group === "ano" ? row.start.slice(0, 4) : group === "mes" ? `${row.start.slice(5, 7)}/${row.start.slice(0, 4)}` : `${br(row.start)} a ${br(row.end)}`}</Link></td>
                    <td className="pr-2 text-right tabular-nums">{row.list.length}</td>
                    <td className="pr-2 text-right tabular-nums">{row.list.filter(isSold).length}</td>
                    {canMoney && <>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.money.grossCents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.money.discountCents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.money.deliveryFeeCents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.money.refundCents)}</td>
                      <td className="pr-2 text-right font-semibold tabular-nums">{formatCents(row.money.salesCents)}</td>
                      <td className="pr-2 text-right tabular-nums">{formatCents(row.money.platformFeeCents)}</td>
                      <td className="text-right tabular-nums">{row.money.costCents === null ? "—" : formatCents(row.money.costCents)}</td>
                    </>}
                  </tr>
                ))}
                <tr className="border-t-2 border-peach font-bold" data-testid="ledger-total">
                  <td className="py-1 pr-2">Total</td><td className="pr-2 text-right tabular-nums">{orders.length}</td><td className="pr-2 text-right tabular-nums">{orders.filter(isSold).length}</td>
                  {canMoney && <>
                    <td className="pr-2 text-right tabular-nums">{formatCents(total.grossCents)}</td><td className="pr-2 text-right tabular-nums">{formatCents(total.discountCents)}</td>
                    <td className="pr-2 text-right tabular-nums">{formatCents(total.deliveryFeeCents)}</td><td className="pr-2 text-right tabular-nums">{formatCents(total.refundCents)}</td>
                    <td className="pr-2 text-right tabular-nums">{formatCents(total.salesCents)}</td><td className="pr-2 text-right tabular-nums">{formatCents(total.platformFeeCents)}</td>
                    <td className="text-right tabular-nums">{total.costCents === null ? "—" : formatCents(total.costCents)}</td>
                  </>}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detailed.length > 0 && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Pedido a pedido {orders.length > DETAIL_LIMIT && <span className="font-sans text-sm font-normal text-coffee-soft">(os {DETAIL_LIMIT} mais recentes; filtre para ver outros)</span>}</h2>
          <ul className="divide-y divide-cream" data-testid="ledger-orders">
            {detailed.map((order) => (
              <li key={order.id} className="py-2 text-sm">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <strong>{order.code}</strong>
                    <span>{formatDateTime(order.paidAt)}</span>
                    <span>{MODALITIES[order.channel === "app" ? order.fulfillment : order.channel]}</span>
                    <span>{STATUS_LABELS[order.status as OrderStatus] ?? order.status}</span>
                    <span>{PAYMENT[order.paymentMethod]}</span>
                    {canMoney && <span className="ml-auto font-semibold tabular-nums">{formatCents(saleCents(order))}</span>}
                  </summary>
                  <div className="grid gap-3 pb-2 pt-1 sm:grid-cols-2">
                    <div>
                      {showCustomer && customers.get(order.id) && <p className="text-coffee-soft">Cliente: {customers.get(order.id)}</p>}
                      <ul>{items.filter((item) => item.order_id === order.id).map((item, index) => (
                        <li key={index} className="flex justify-between gap-2"><span>{item.quantity}× {item.name}</span>{canMoney && <span className="tabular-nums">{formatCents(item.line_total_cents)}</span>}</li>
                      ))}</ul>
                      {canMoney && (
                        <dl className="mt-1 text-xs text-coffee-soft">
                          {order.discountCents > 0 && <div className="flex justify-between"><dt>Desconto</dt><dd>− {formatCents(order.discountCents)}</dd></div>}
                          {order.deliveryFeeCents > 0 && <div className="flex justify-between"><dt>Entrega</dt><dd>{formatCents(order.deliveryFeeCents)}</dd></div>}
                          {order.refundedCents > 0 && <div className="flex justify-between"><dt>Estornado</dt><dd>− {formatCents(order.refundedCents)}</dd></div>}
                          <div className="flex justify-between"><dt>Taxa do Chegô</dt><dd>{formatCents(order.platformFeeCents)}</dd></div>
                        </dl>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold">Estoque</p>
                      {movements.filter((move) => move.order_id === order.id).length === 0 ? <p className="text-xs text-coffee-soft">Sem movimentação de estoque ligada.</p> : (
                        <ul className="text-xs">{movements.filter((move) => move.order_id === order.id).map((move, index) => (
                          <li key={index}>{MOVEMENT_LABELS[move.kind]}: {move.item_name} {Number(move.quantity) > 0 ? "+" : ""}{Number(move.quantity).toLocaleString("pt-BR")}</li>
                        ))}</ul>
                      )}
                      <Link href={`/lojista/pedidos/${order.id}`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand-dark underline">Abrir pedido</Link>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
