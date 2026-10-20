import type { Metadata } from "next";
import { Suspense } from "react";
import { Stat } from "@/components/ui/Stats";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { feePerformance } from "@/lib/fees/performance";
import { addDays, businessDate } from "@/lib/fees/rules";
import { formatCents } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { RevenueSimulator } from "./RevenueSimulator";

export const metadata: Metadata = { title: "Simulador de receita" };

type Props = { searchParams: Promise<{ de?: string; ate?: string }> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function SimulatorPage(props: Props) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Simulator {...props} />
    </Suspense>
  );
}

async function Simulator({ searchParams }: Props) {
  await requireRole("admin");
  const [params, at, settings] = await Promise.all([searchParams, now(), getSettings()]);
  const today = businessDate(at, settings.business_day_cutoff_hour);
  const to = params.ate && DATE.test(params.ate) ? params.ate : today;
  const from = params.de && DATE.test(params.de) && params.de <= to ? params.de : addDays(to, -29);
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  const real = await feePerformance({ from, to });
  const brDate = (value: string) => value.split("-").reverse().join("/");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl">Receita do Chegô</h1>
        <p className="text-coffee-soft">
          Tarifa em produção: <strong>{formatCents(settings.order_fee_cents)}</strong> por pedido entregue ou retirado. Abaixo, primeiro o que
          aconteceu de verdade; depois, o simulador, separado.
        </p>
      </header>

      <section aria-labelledby="real-title" data-testid="real-performance" className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="real-title" className="text-2xl">Desempenho real</h2>
            <p className="text-sm text-coffee-soft">Só registros financeiros gravados: taxas lançadas, fechamentos e pagamentos confirmados.</p>
          </div>
          <form className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs font-semibold">De<input type="date" name="de" defaultValue={from} className="min-h-11 rounded-xl px-2 ring-1 ring-peach" /></label>
            <label className="flex flex-col text-xs font-semibold">Até<input type="date" name="ate" defaultValue={to} className="min-h-11 rounded-xl px-2 ring-1 ring-peach" /></label>
            <button className="min-h-11 rounded-full bg-brand-dark px-4 text-sm font-bold text-white">Ver período</button>
          </form>
        </div>
        <p className="text-sm font-semibold">{brDate(from)} a {brDate(to)} ({days} dias)</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Lojas com pedido concluído" value={real.activeStores} />
          <Stat label="Pedidos com taxa" value={real.eligibleOrders} hint="já sem os estornos" />
          <Stat label="Taxas geradas" value={formatCents(real.generatedCents)} hint={real.reversedCents > 0 ? `${formatCents(real.reversedCents)} estornados` : "gerado não é recebido"} />
          <Stat label="Recebido (Pix confirmado)" value={formatCents(real.paidCents)} />
          <Stat label="A receber hoje" value={formatCents(real.pendingCents)} hint="fechamentos não pagos" href="/admin/taxas" />
          <Stat label="Ainda sem fechamento" value={formatCents(real.openCents)} hint="taxas do período não fechadas" />
        </div>
      </section>

      <RevenueSimulator real={{ generatedCents: real.generatedCents, days }} />
    </div>
  );
}
