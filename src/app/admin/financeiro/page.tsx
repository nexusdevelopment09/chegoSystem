import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Stats";
import { commissionsByStore, reconciliation } from "@/lib/admin/metrics";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { toLocal } from "@/lib/time";

export const metadata: Metadata = { title: "Financeiro" };

const INVOICE = { open: "Em aberto", paid: "Paga", overdue: "Vencida", cancelled: "Cancelada" } as const;
type SearchParams = Promise<{ mes?: string }>;

export default function AdminFinancePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Finance searchParams={searchParams} />
    </Suspense>
  );
}

/** "2026-10" -> the first instant of that month and of the next one, Maceió time. */
function monthPeriod(month: string) {
  const [year, index] = month.split("-").map(Number);
  const start = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1, 3));
  return { from: start(year, index), to: index === 12 ? start(year + 1, 1) : start(year, index + 1) };
}

async function Finance({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const at = await now();
  const current = toLocal(at).date.slice(0, 7);
  const requested = (await searchParams).mes;
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : current;
  const period = monthPeriod(month);

  const [lines, recon, invoices] = await Promise.all([
    commissionsByStore(period),
    reconciliation(period),
    sql<{ id: string; store_name: string; period_start: string; amount_cents: number; status: keyof typeof INVOICE; due_date: string }[]>`
      select i.id, s.name as store_name, i.period_start::text, i.amount_cents, i.status, i.due_date::text
      from invoices i join stores s on s.id = i.store_id
      order by (i.status = 'overdue') desc, (i.status = 'open') desc, i.period_start desc, s.name limit 80`,
  ]);

  const sum = (pick: (line: (typeof lines)[number]) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const months = Array.from({ length: 6 }, (_, back) => {
    const date = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 1 - back, 1));
    return date.toISOString().slice(0, 7);
  });
  const br = (value: string) => value.split("-").reverse().join("/");

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl">Financeiro</h1>
        <div className="flex flex-wrap gap-2">
          {months.map((value) => (
            <Link key={value} href={`/admin/financeiro?mes=${value}`} aria-current={value === month ? "true" : undefined}
              className={buttonClass(value === month ? "primary" : "secondary", "min-h-11 px-3 text-sm")}>{br(value)}</Link>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendas das lojas (GMV)" value={formatCents(sum((line) => line.gmvCents))} />
        <Stat label="Comissões" value={formatCents(sum((line) => line.commissionCents))} />
        <Stat label="Taxas de serviço" value={formatCents(sum((line) => line.serviceFeeCents))} />
        <Stat label="Mensalidades recebidas" value={formatCents(sum((line) => line.subscriptionCents))} />
      </div>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl">Comissões por loja em {br(month)}</h2>
          <a href={`/admin/financeiro/exportar?mes=${month}`} download className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Baixar relatório do contador (CSV)</a>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="commissions">
            <thead>
              <tr className="text-left text-coffee-soft">
                <th scope="col" className="py-1 pr-2">Loja</th><th scope="col" className="pr-2 text-right">Pedidos</th>
                <th scope="col" className="pr-2 text-right">Vendas</th><th scope="col" className="pr-2 text-right">Comissão</th>
                <th scope="col" className="pr-2 text-right">Taxa de serviço</th><th scope="col" className="text-right">Mensalidade</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.storeId} className="border-t border-cream">
                  <td className="py-1 pr-2 font-semibold"><Link href={`/admin/lojas/${line.storeId}`} className="text-brand-dark underline">{line.storeName}</Link></td>
                  <td className="pr-2 text-right tabular-nums">{line.orders}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(line.gmvCents)}</td>
                  <td className="pr-2 text-right font-semibold tabular-nums">{formatCents(line.commissionCents)}</td>
                  <td className="pr-2 text-right tabular-nums">{formatCents(line.serviceFeeCents)}</td>
                  <td className="text-right tabular-nums">{formatCents(line.subscriptionCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lines.length === 0 && <p className="text-sm text-coffee-soft">Nenhuma venda neste mês.</p>}
      </section>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach" data-testid="reconciliation">
        <h2 className="mb-1 text-xl">Conciliação com o gateway</h2>
        <p className="mb-2 text-sm text-coffee-soft">Compara o que o gateway cobrou, dividiu e devolveu com o que o sistema calculou, pedido a pedido.</p>
        {recon.mismatches.length === 0 ? (
          <p className="rounded-2xl bg-cream px-3 py-2 font-semibold text-success">Tudo confere: {recon.checked} pedidos conferidos, nenhuma diferença.</p>
        ) : (
          <>
            <p role="alert" className="mb-2 rounded-2xl bg-danger px-3 py-2 font-bold text-white">{recon.mismatches.length} diferença{recon.mismatches.length > 1 ? "s" : ""} em {recon.checked} pedidos conferidos.</p>
            <ul className="text-sm">
              {recon.mismatches.map((mismatch, index) => (
                <li key={index} className="border-b border-cream py-1">
                  <Link href={`/admin/pedidos/${mismatch.orderId}`} className="font-semibold text-brand-dark underline">{mismatch.code}</Link> · {mismatch.storeName}: {mismatch.problem}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Faturas de mensalidade</h2>
        <ul className="text-sm">
          {invoices.map((invoice) => (
            <li key={invoice.id} data-testid="admin-invoice" className="flex flex-wrap justify-between gap-2 border-b border-cream py-1">
              <span><strong>{invoice.store_name}</strong> · {br(invoice.period_start).slice(3)} · vence {br(invoice.due_date)}</span>
              <span className={invoice.status === "overdue" ? "font-bold text-danger" : invoice.status === "paid" ? "text-success" : "font-semibold"}>
                {formatCents(invoice.amount_cents)} · {INVOICE[invoice.status]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-coffee-soft">Loja com fatura vencida há mais de 10 dias pode ser suspensa na página da loja. A suspensão é sempre uma decisão sua, nunca automática.</p>
      </section>
    </div>
  );
}
