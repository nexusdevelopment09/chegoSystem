"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";
import { SCENARIOS, simulate, type Scenario, type SimulationInput } from "@/lib/fees/simulator";

const inputClass = "min-h-11 w-full rounded-xl bg-white px-3 text-base ring-1 ring-peach focus:outline-none focus:ring-2 focus:ring-brand-dark";

/**
 * Simulador de receita. Só faz contas no navegador: não lê nem grava nada no banco, então
 * nenhuma simulação vira taxa, cobrança ou número de produção.
 */
export function RevenueSimulator({ real }: { real: { generatedCents: number; days: number } }) {
  const [scenario, setScenario] = useState<Scenario>("conservador");
  const [input, setInput] = useState<SimulationInput>(SCENARIOS.conservador.input);
  const result = simulate(input);
  const sameDays = simulate({ ...input, days: real.days });

  const set = <K extends keyof SimulationInput>(key: K, value: SimulationInput[K]) => setInput({ ...input, [key]: value });
  const number = (key: "stores" | "ordersPerStoreDay" | "days" | "eligiblePercent" | "monthlyStoreGrowthPercent", label: string, hint?: string, step = "1") => (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      <input type="number" inputMode="decimal" step={step} value={Number.isFinite(input[key]) ? input[key] : ""} className={inputClass}
        onChange={(event) => set(key, event.target.value === "" ? 0 : Number(event.target.value))} />
      {hint && <span className="text-xs font-normal text-coffee-soft">{hint}</span>}
    </label>
  );

  return (
    <section aria-labelledby="sim-title" data-testid="simulator" className="flex flex-col gap-4 rounded-card border-2 border-dashed border-brand bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sim-title" className="text-2xl">Simulador de receita</h2>
        <span className="rounded-full bg-brand-dark px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">Simulação · não é dinheiro real</span>
      </div>
      <p className="-mt-2 text-sm text-coffee-soft">
        Receita bruta estimada = lojas × pedidos entregues ou retirados por loja/dia × dias × tarifa. Não é lucro: não desconta custos,
        impostos nem inadimplência. Mudar a tarifa aqui não muda a tarifa cobrada das lojas.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Cenário
          <select value={scenario} className={inputClass} data-testid="sim-scenario"
            onChange={(event) => { const next = event.target.value as Scenario; setScenario(next); setInput(SCENARIOS[next].input); }}>
            {(Object.keys(SCENARIOS) as Scenario[]).map((key) => <option key={key} value={key}>{SCENARIOS[key].label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setInput(SCENARIOS[scenario].input)}
          className="min-h-11 rounded-full px-4 text-sm font-bold text-brand-dark ring-1 ring-peach hover:ring-brand">
          Restaurar valores do cenário
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {number("stores", "Lojas")}
        {number("ordersPerStoreDay", "Pedidos por loja por dia", undefined, "0.1")}
        {number("days", "Período (dias)")}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Tarifa simulada (R$)
          <input type="number" inputMode="decimal" step="0.01" min={0} value={input.feeCents / 100} className={inputClass} data-testid="sim-fee"
            onChange={(event) => set("feeCents", Math.round(Number(event.target.value || 0) * 100))} />
          <span className="text-xs font-normal text-coffee-soft">Padrão: R$ 0,50. Só vale nesta simulação.</span>
        </label>
        {number("monthlyStoreGrowthPercent", "Crescimento de lojas por mês (%)", "Usado na projeção de 12 meses.")}
        <div className="flex flex-col gap-1 text-sm font-semibold">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={input.ordersAreEligible} onChange={(event) => set("ordersAreEligible", event.target.checked)} className="size-5 accent-brand-dark" />
            Os pedidos informados já são os entregues ou retirados
          </label>
          {!input.ordersAreEligible && number("eligiblePercent", "Pedidos que chegam a ser concluídos (%)")}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sim-results">
        <Result label="Pedidos com tarifa" value={result.eligibleOrders.toLocaleString("pt-BR")} hint={`em ${input.days} dias`} testId="sim-orders" />
        <Result label={`Receita em ${input.days} dias`} value={formatCents(result.revenueCents)} testId="sim-revenue" strong />
        <Result label="Média por dia" value={formatCents(result.dailyCents)} testId="sim-daily" />
        <Result label="Por semana" value={formatCents(result.weeklyCents)} />
        <Result label="Por mês (30 dias)" value={formatCents(result.monthly30Cents)} testId="sim-monthly" />
        <Result label="Por ano (365 dias)" value={formatCents(result.annualCents)} hint="sem crescimento" />
        <Result label="12 meses com crescimento" value={formatCents(result.growthYearCents)} hint={`lojas +${input.monthlyStoreGrowthPercent}% ao mês`} />
        <Result label={`Simulado × realizado (${real.days} dias)`} value={formatCents(sameDays.revenueCents - real.generatedCents)}
          hint={`simulado ${formatCents(sameDays.revenueCents)} · realizado ${formatCents(real.generatedCents)}`} />
      </dl>

      <GrowthChart growth={result.growth} />

      <div>
        <h3 className="mb-2 text-lg">Comparação entre cenários (mesma tarifa)</h3>
        <div className="overflow-x-auto" role="region" aria-label="Comparação entre cenários" tabIndex={0}>
          <table className="w-full min-w-[480px] text-sm" data-testid="sim-compare">
            <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Cenário</th><th className="pr-2 text-right">Lojas</th><th className="pr-2 text-right">Pedidos/loja/dia</th><th className="pr-2 text-right">Por mês</th><th className="text-right">12 meses</th></tr></thead>
            <tbody>
              {(Object.keys(SCENARIOS) as Scenario[]).map((key) => {
                const preset = { ...SCENARIOS[key].input, feeCents: input.feeCents };
                const outcome = simulate(preset);
                return (
                  <tr key={key} className="border-t border-cream">
                    <td className="py-1 pr-2 font-semibold">{SCENARIOS[key].label}</td>
                    <td className="pr-2 text-right tabular-nums">{preset.stores}</td>
                    <td className="pr-2 text-right tabular-nums">{preset.ordersPerStoreDay}</td>
                    <td className="pr-2 text-right tabular-nums">{formatCents(outcome.monthly30Cents)}</td>
                    <td className="text-right tabular-nums">{formatCents(outcome.growthYearCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Result({ label, value, hint, strong = false, testId }: { label: string; value: string; hint?: string; strong?: boolean; testId?: string }) {
  return (
    <div className={`rounded-2xl p-3 ${strong ? "bg-peach" : "bg-cream"}`}>
      <dt className="text-xs font-semibold text-coffee-soft">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums" data-testid={testId}>{value}</dd>
      {hint && <dd className="text-xs text-coffee-soft">{hint}</dd>}
    </div>
  );
}

/** Barras da receita estimada mês a mês (uma série: o título já diz o que é, sem legenda). */
function GrowthChart({ growth }: { growth: { month: number; stores: number; revenueCents: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...growth.map((item) => item.revenueCents), 1);
  const width = 600;
  const height = 200;
  const gap = 6;
  const bar = (width - gap * (growth.length - 1)) / growth.length;
  const active = hover === null ? null : growth[hover];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-lg font-semibold">Receita estimada por mês, com as lojas crescendo</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height + 20}`} className="h-auto w-full" role="img"
          aria-label={`Receita estimada de ${formatCents(growth[0].revenueCents)} no mês 1 a ${formatCents(growth.at(-1)!.revenueCents)} no mês 12`}
          onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={width} y1={height} y2={height} stroke="currentColor" className="text-peach" strokeWidth={1} />
          {growth.map((item, index) => {
            const h = Math.max((item.revenueCents / max) * (height - 24), item.revenueCents > 0 ? 2 : 0);
            const x = index * (bar + gap);
            return (
              <g key={item.month} onMouseEnter={() => setHover(index)}>
                {/* Área de toque maior que a barra. */}
                <rect x={x} y={0} width={bar} height={height} fill="transparent" />
                <path d={`M${x},${height} V${height - h + 4} q0,-4 4,-4 h${bar - 8} q4,0 4,4 V${height} Z`}
                  className={hover === null || hover === index ? "fill-brand-dark" : "fill-brand-dark/40"} />
                <text x={x + bar / 2} y={height + 15} textAnchor="middle" className="fill-coffee-soft text-[11px]">{item.month}</text>
              </g>
            );
          })}
          <text x={width} y={12} textAnchor="end" className="fill-coffee text-[12px] font-semibold">{formatCents(growth.at(-1)!.revenueCents)}</text>
        </svg>
        {active && (
          <div role="status" className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-xl bg-coffee px-3 py-2 text-xs text-white shadow-lg">
            Mês {active.month}: <strong>{formatCents(active.revenueCents)}</strong> · {active.stores} lojas
          </div>
        )}
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">Ver em tabela</summary>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-coffee-soft"><th className="py-1">Mês</th><th className="text-right">Lojas</th><th className="text-right">Receita estimada</th></tr></thead>
          <tbody>
            {growth.map((item) => (
              <tr key={item.month} className="border-t border-cream"><td className="py-1">{item.month}</td><td className="text-right tabular-nums">{item.stores}</td><td className="text-right tabular-nums">{formatCents(item.revenueCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
