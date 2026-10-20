import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDay } from "@/components/fees/FeeViews";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Stat } from "@/components/ui/Stats";
import { sql } from "@/lib/db";
import { feeSummary } from "@/lib/fees/closing";
import { addDays } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { STORE_PAYMENT_LABELS } from "@/lib/payments/collection";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { getSettings } from "@/lib/settings";
import { DAY_MS, fromLocal } from "@/lib/time";
import { closeToday } from "../taxas/actions";

export const metadata: Metadata = { title: "Financeiro" };

// Sem mensalidade nem comissão: o cliente paga direto à loja e o Chegô cobra uma taxa
// fixa por pedido concluído, somada no fechamento do expediente (src/lib/fees/).

type PaymentMethod = keyof typeof STORE_PAYMENT_LABELS;
const METHOD_SHORT: Record<PaymentMethod, string> = { pix: "Pix", card: "Cartão", cash: "Dinheiro" };
const NOT_SOLD = ["rejected", "cancelled", "refunded", "expired"];
const COMPLETED = ["delivered", "picked_up", "partially_refunded"];
const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";

export default function FinancePage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Finance />
    </Suspense>
  );
}

async function Finance() {
  const { store, at } = await getMerchantContext("financeiro.ver");
  const [summary, settings] = await Promise.all([feeSummary(store.id, at), getSettings()]);
  // O expediente de hoje vai da hora de corte até a mesma hora do dia seguinte.
  const cutoff = settings.business_day_cutoff_hour * 60;
  const dayStart = fromLocal(summary.today, cutoff);
  const dayEnd = fromLocal(addDays(summary.today, 1), cutoff);

  const lines = await sql<{
    id: string; code: string; paid_at: Date; status: OrderStatus; total_cents: number; payment_method: PaymentMethod; fee_cents: number;
  }[]>`
    select o.id, o.code, o.paid_at, o.status, o.total_cents, o.payment_method,
           coalesce((select sum(f.amount_cents) from fee_entries f
                     where f.order_id = o.id and f.kind in ('order_fee', 'order_fee_reversal')), 0)::int as fee_cents
    from orders o
    where o.store_id = ${store.id} and o.paid_at is not null
      and o.paid_at >= ${new Date(Math.min(at.getTime() - 30 * DAY_MS, dayStart.getTime()))} and o.paid_at < ${dayEnd}
    order by o.paid_at desc
    limit 500`;

  const sold = lines.filter((line) => !NOT_SOLD.includes(line.status));
  const recent = lines.filter((line) => line.paid_at.getTime() >= at.getTime() - 30 * DAY_MS);
  const today = sold.filter((line) => line.paid_at >= dayStart);
  const todayDone = today.filter((line) => COMPLETED.includes(line.status));
  type Line = (typeof lines)[number];
  const sum = (list: Line[], pick: (line: Line) => number) => list.reduce((total, line) => total + pick(line), 0);
  const byMethod = (Object.keys(METHOD_SHORT) as PaymentMethod[])
    .map((method) => ({ method, cents: sum(today.filter((line) => line.payment_method === method), (line) => line.total_cents) }))
    .filter((row) => row.cents > 0);
  const toPayCents = summary.dueCents + summary.openCents;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Financeiro</h1>
        <p className="text-coffee-soft">
          Sem mensalidade e sem comissão: o cliente paga direto para a loja e o Chegô cobra {formatCents(settings.order_fee_cents)} por
          pedido concluído (entregue ou retirado).
        </p>
      </header>

      <section className={card} aria-labelledby="cash-closing" data-testid="cash-closing">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cash-closing" className="text-xl">Fechamento de caixa de hoje ({formatDay(summary.today)})</h2>
          <span className="text-sm text-coffee-soft">O dia vira às {settings.business_day_cutoff_hour}h</span>
        </div>
        <dl className="text-base">
          <div className="flex justify-between py-1"><dt>Pedidos vendidos</dt><dd>{today.length}</dd></div>
          {byMethod.map((row) => (
            <div key={row.method} className="flex justify-between py-1 pl-3 text-coffee-soft">
              <dt>{METHOD_SHORT[row.method]}</dt><dd className="tabular-nums">{formatCents(row.cents)}</dd>
            </div>
          ))}
          <div className="flex justify-between py-1 font-semibold"><dt>Total vendido</dt><dd className="tabular-nums">{formatCents(sum(today, (line) => line.total_cents))}</dd></div>
          <div className="flex justify-between py-1">
            <dt>Concluídos (entregues ou retirados)</dt><dd>{todayDone.length}</dd>
          </div>
          <div className="flex justify-between border-t border-peach pt-2 text-xl font-bold" data-testid="cash-closing-fee">
            <dt>A pagar ao Chegô hoje</dt><dd className="tabular-nums">{formatCents(summary.todayFeesCents)}</dd>
          </div>
        </dl>
        <p className="text-sm text-coffee-soft">
          {summary.todayOrders} × {formatCents(settings.order_fee_cents)} pelos pedidos concluídos. Pedido em andamento entra quando for entregue
          ou retirado; recusado ou cancelado não paga.
        </p>
        {summary.openCents > 0 ? (
          <ActionForm action={closeToday} className="flex flex-col gap-3">
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" name="confirm" className="size-5 shrink-0 accent-brand-dark" />
              Conferi os valores acima
            </label>
            <SubmitButton className="self-start">Fechar caixa e gerar o Pix</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm font-semibold">Nada em aberto para fechar agora.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendas em 30 dias" value={formatCents(sum(recent.filter((line) => !NOT_SOLD.includes(line.status)), (line) => line.total_cents))} />
        <Stat label="Pedidos concluídos (30 dias)" value={recent.filter((line) => COMPLETED.includes(line.status)).length} />
        <Stat label="Taxas do Chegô (30 dias)" value={formatCents(sum(recent, (line) => line.fee_cents))} hint={`${formatCents(settings.order_fee_cents)} por pedido concluído`} />
        <Stat
          label="Total a pagar ao Chegô"
          value={formatCents(toPayCents)}
          hint={summary.nextDueDate ? `Vence ${formatDay(summary.nextDueDate)}` : "Fechados e em aberto"}
          href="/lojista/taxas"
        />
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl">Vendas por pedido (30 dias)</h2>
          <Link href="/lojista/taxas" className="min-h-11 font-semibold text-brand-dark">Ver fechamentos e pagar →</Link>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabela (role para o lado para ver tudo)">
          <table className="w-full min-w-[640px] text-sm" data-testid="statement">
            <thead>
              <tr className="text-left text-coffee-soft">
                <th scope="col" className="py-1 pr-2">Pedido</th><th scope="col" className="pr-2">Data</th><th scope="col" className="pr-2">Situação</th>
                <th scope="col" className="pr-2">Pagamento</th><th scope="col" className="pr-2 text-right">Total</th>
                <th scope="col" className="text-right">Taxa do Chegô</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((line) => (
                <tr key={line.id} className="border-t border-cream">
                  <td className="py-1 pr-2 font-semibold"><Link href={`/lojista/pedidos/${line.id}`} className="hover:underline">{line.code}</Link></td>
                  <td className="pr-2">{formatDateTime(line.paid_at)}</td>
                  <td className="pr-2">{STATUS_LABELS[line.status]}</td>
                  <td className="pr-2">{METHOD_SHORT[line.payment_method] ?? line.payment_method}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(line.total_cents)}</td>
                  <td className="text-right tabular-nums">{line.fee_cents !== 0 ? formatCents(line.fee_cents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recent.length === 0 && <p className="text-sm text-coffee-soft">Nenhuma venda nos últimos 30 dias.</p>}
        <p className="text-sm text-coffee-soft">
          A taxa aparece quando o pedido é concluído. Pedidos recusados, cancelados ou feitos antes da cobrança por pedido ficam sem taxa (—).
        </p>
      </section>
    </div>
  );
}
