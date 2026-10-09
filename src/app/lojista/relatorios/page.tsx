import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Bars, Stat } from "@/components/ui/Stats";
import { formatCents } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { storeReport } from "@/lib/merchant/reports";
import { DAY_MS } from "@/lib/time";

export const metadata: Metadata = { title: "Relatórios" };

const PERIODS = [
  { days: 1, label: "Hoje" },
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
];

type SearchParams = Promise<{ dias?: string }>;

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: { searchParams: SearchParams }) {
  const { dias } = await searchParams;
  const days = PERIODS.find((period) => String(period.days) === dias)?.days ?? 30;
  const { store, at } = await getMerchantContext(["owner"]);
  const report = await storeReport(store.id, { from: new Date(at.getTime() - days * DAY_MS), to: at });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl">Relatórios</h1>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((period) => (
            <Link key={period.days} href={`/lojista/relatorios?dias=${period.days}`} aria-current={period.days === days ? "true" : undefined}
              className={buttonClass(period.days === days ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>
              {period.label}
            </Link>
          ))}
          <a href={`/lojista/relatorios/exportar?dias=${days}`} download className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Baixar CSV</a>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos" value={report.orders} />
        <Stat label="Vendas" value={formatCents(report.grossCents)} hint="Já sem os reembolsos" />
        <Stat label="Ticket médio" value={formatCents(report.ticketCents)} />
        <Stat label="A receber" value={formatCents(report.netCents)} hint="Já sem comissão e taxas" />
        <Stat label="Recusas e cancelamentos" value={`${(report.refusalRate * 100).toFixed(1).replace(".", ",")}%`} hint={`${report.rejected} recusados, ${report.cancelled} cancelados`} />
        <Stat label="Tempo médio de aceite" value={report.avgAcceptMinutes === null ? "—" : `${report.avgAcceptMinutes} min`} />
        <Stat label="Tempo médio de preparo" value={report.avgPrepMinutes === null ? "—" : `${report.avgPrepMinutes} min`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Produtos mais vendidos</h2>
          {report.topProducts.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={report.topProducts.map((product) => ({ label: product.name, value: product.quantity }))} format={(value) => `${value} un.`} />}
        </section>

        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Horários de pico</h2>
          {report.byHour.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={report.byHour.map((row) => ({ label: `${row.hour}h`, value: row.orders }))} format={(value) => `${value} ped.`} />}
        </section>

        <section className="rounded-card bg-white p-4 ring-1 ring-peach lg:col-span-2">
          <h2 className="mb-2 text-xl">Vendas por dia</h2>
          {report.byDay.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars rows={report.byDay.slice(-31).map((row) => ({ label: row.day.split("-").reverse().slice(0, 2).join("/"), value: row.grossCents }))} format={formatCents} />}
        </section>
      </div>
    </div>
  );
}
