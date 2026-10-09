import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { sql, withUser } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { payoutDate, storeStatement } from "@/lib/merchant/reports";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { DAY_MS } from "@/lib/time";
import { payInvoice } from "../owner-actions";
import { Stat } from "@/components/ui/Stats";

export const metadata: Metadata = { title: "Financeiro" };

const INVOICE_LABELS = { open: "Em aberto", paid: "Paga", overdue: "Vencida", cancelled: "Cancelada" } as const;

export default function FinancePage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Finance />
    </Suspense>
  );
}

async function Finance() {
  const { profile, store, at } = await getMerchantContext(["owner"]);
  const lines = await storeStatement(store.id, { from: new Date(at.getTime() - 30 * DAY_MS), to: at });

  // Read as the owner of the store: Row Level Security gives only this store's invoices.
  const { invoices, subscription } = await withUser(profile.id, async (tx) => ({
    invoices: await tx<{ id: string; period_start: string; amount_cents: number; status: keyof typeof INVOICE_LABELS; due_date: string; paid_at: Date | null }[]>`
      select id, period_start::text, amount_cents, status, due_date::text, paid_at
      from invoices where store_id = ${store.id} order by period_start desc limit 12`,
    subscription: (await tx<{ name: string; monthly_price_cents: number; free_until: string | null }[]>`
      select p.name, p.monthly_price_cents, s.free_until::text
      from store_subscriptions s join subscription_plans p on p.id = s.plan_id where s.store_id = ${store.id}`)[0],
  }));
  const [{ commission_rate }] = await sql<{ commission_rate: string }[]>`select commission_rate from store_private where store_id = ${store.id}`;

  const valid = lines.filter((line) => !["rejected", "cancelled", "refunded"].includes(line.status));
  const pending = valid.filter((line) => payoutDate(line.paidAt) > at);
  const sum = (list: typeof lines, pick: (line: (typeof lines)[number]) => number) => list.reduce((total, line) => total + pick(line), 0);
  const overdue = invoices.some((invoice) => invoice.status === "overdue");
  const brDate = (value: string) => value.split("-").reverse().join("/");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Financeiro</h1>

      {overdue && (
        <p role="alert" className="rounded-2xl bg-danger px-4 py-3 font-bold text-white">
          Você tem fatura vencida. Regularize para a loja continuar no ar.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendas em 30 dias" value={formatCents(sum(valid, (line) => line.grossCents))} />
        <Stat label="Comissão do Chegô" value={formatCents(sum(valid, (line) => line.commissionCents))} hint={`Sua taxa hoje: ${(Number(commission_rate) * 100).toFixed(1).replace(".", ",")}%`} />
        <Stat label="Líquido em 30 dias" value={formatCents(sum(valid, (line) => line.netCents))} />
        <Stat label="Repasses a caminho" value={formatCents(sum(pending, (line) => line.netCents))} hint="Caem 2 dias úteis depois da venda" />
      </div>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Mensalidade</h2>
        {subscription && (
          <p className="mb-2 text-sm">
            Plano <strong>{subscription.name}</strong> · {formatCents(subscription.monthly_price_cents)} por mês
            {subscription.free_until && ` · grátis até ${brDate(subscription.free_until)} (loja fundadora)`}
          </p>
        )}
        {invoices.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma fatura ainda.</p> : (
          <ul className="flex flex-col gap-2">
            {invoices.map((invoice) => (
              <li key={invoice.id} data-testid="invoice" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
                <span>
                  <strong>{brDate(invoice.period_start).slice(3)}</strong> · {formatCents(invoice.amount_cents)} ·{" "}
                  <span className={invoice.status === "overdue" ? "font-bold text-danger" : invoice.status === "paid" ? "text-success" : "font-semibold"}>
                    {INVOICE_LABELS[invoice.status]}
                  </span>
                  <span className="block text-sm text-coffee-soft">
                    {invoice.paid_at ? `Paga em ${formatDateTime(invoice.paid_at)}` : `Vence em ${brDate(invoice.due_date)}`}
                  </span>
                </span>
                {(invoice.status === "open" || invoice.status === "overdue") && (
                  <ActionForm action={payInvoice}>
                    <input type="hidden" name="id" value={invoice.id} />
                    <SubmitButton className="min-h-11 px-4 text-sm">Pagar pelo app</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Extrato por pedido (30 dias)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm" data-testid="statement">
            <thead>
              <tr className="text-left text-coffee-soft">
                <th scope="col" className="py-1 pr-2">Pedido</th><th scope="col" className="pr-2">Pago em</th><th scope="col" className="pr-2">Situação</th>
                <th scope="col" className="pr-2 text-right">Total</th><th scope="col" className="pr-2 text-right">Comissão</th>
                <th scope="col" className="pr-2 text-right">Reembolso</th><th scope="col" className="pr-2 text-right">Líquido</th><th scope="col">Repasse</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.orderId} className="border-t border-cream">
                  <td className="py-1 pr-2 font-semibold">{line.code}</td>
                  <td className="pr-2">{formatDateTime(line.paidAt)}</td>
                  <td className="pr-2">{STATUS_LABELS[line.status as OrderStatus]}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(line.grossCents)}</td>
                  <td className="pr-2 text-right tabular-nums">− {formatCents(line.commissionCents)}</td>
                  <td className="pr-2 text-right tabular-nums">{line.refundedFromStoreCents > 0 ? `− ${formatCents(line.refundedFromStoreCents)}` : "—"}</td>
                  <td className="pr-2 text-right font-semibold tabular-nums">{formatCents(line.netCents)}</td>
                  <td>{line.netCents > 0 ? (payoutDate(line.paidAt) > at ? `Previsto ${formatDateTime(payoutDate(line.paidAt)).slice(0, 10)}` : "Repassado") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lines.length === 0 && <p className="text-sm text-coffee-soft">Nenhuma venda nos últimos 30 dias.</p>}
      </section>
    </div>
  );
}
