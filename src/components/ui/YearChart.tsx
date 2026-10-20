"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";

// Paleta categórica validada (ordem fixa; nunca em ciclo): azul, laranja, verde-água, amarelo.
// Duas delas têm pouco contraste com o fundo: por isso a legenda e a tabela vêm sempre junto.
export const YEAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type YearSeries = { label: string; values: (number | null)[] };

/**
 * Barras agrupadas por mês, uma cor por ano. Mês sem dado fica sem barra (não é zero).
 * Passar o mouse (ou focar) num mês mostra os valores de todos os anos.
 */
export function YearChart({ title, series, kind, testId }: { title: string; series: YearSeries[]; kind: "money" | "orders"; testId?: string }) {
  // Funções não passam do servidor para o navegador: o formato vem como um nome.
  const format = (value: number) => (kind === "money" ? formatCents(value) : `${value} pedido${value === 1 ? "" : "s"}`);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((serie) => serie.values.map((value) => value ?? 0)));
  const width = 720;
  const height = 220;
  const groupWidth = width / 12;
  const barWidth = Math.max(4, (groupWidth - 10) / Math.max(1, series.length) - 2);

  return (
    <figure className="flex flex-col gap-2" data-testid={testId}>
      <figcaption className="text-lg font-semibold">{title}</figcaption>
      <ul className="flex flex-wrap gap-3 text-sm" aria-label="Legenda">
        {series.map((serie, index) => (
          <li key={serie.label} className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: YEAR_COLORS[index] }} aria-hidden="true" />{serie.label}</li>
        ))}
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height + 22}`} className="h-auto w-full" role="img" aria-label={`${title}, por mês`} onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={width} y1={height} y2={height} stroke="currentColor" className="text-peach" />
          {MONTHS.map((month, monthIndex) => {
            const x0 = monthIndex * groupWidth + 5;
            return (
              <g key={month} onMouseEnter={() => setHover(monthIndex)} onFocus={() => setHover(monthIndex)} tabIndex={0} aria-label={`${month}: ${series.map((serie) => `${serie.label} ${serie.values[monthIndex] === null ? "sem dados" : format(serie.values[monthIndex]!)}`).join(", ")}`}>
                <rect x={monthIndex * groupWidth} y={0} width={groupWidth} height={height} fill={hover === monthIndex ? "rgba(0,0,0,0.04)" : "transparent"} />
                {series.map((serie, index) => {
                  const value = serie.values[monthIndex];
                  if (value === null || value <= 0) return null;
                  const h = Math.max(2, (value / max) * (height - 12));
                  const x = x0 + index * (barWidth + 2);
                  return <path key={serie.label} d={`M${x},${height} V${height - h + 3} q0,-3 3,-3 h${barWidth - 6} q3,0 3,3 V${height} Z`} fill={YEAR_COLORS[index]} />;
                })}
                <text x={monthIndex * groupWidth + groupWidth / 2} y={height + 16} textAnchor="middle" className="fill-coffee-soft text-[11px]">{month}</text>
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div role="status" className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-xl bg-coffee px-3 py-2 text-xs text-white shadow-lg">
            <strong className="capitalize">{MONTHS[hover]}</strong>
            {series.map((serie, index) => (
              <span key={serie.label} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: YEAR_COLORS[index] }} />{serie.label}: {serie.values[hover] === null ? "sem dados" : format(serie.values[hover]!)}</span>
            ))}
          </div>
        )}
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">Ver em tabela</summary>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} em tabela`}>
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Mês</th>{series.map((serie) => <th key={serie.label} className="pr-2 text-right">{serie.label}</th>)}</tr></thead>
            <tbody>{MONTHS.map((month, index) => (
              <tr key={month} className="border-t border-cream"><td className="py-1 pr-2 capitalize">{month}</td>
                {series.map((serie) => <td key={serie.label} className="pr-2 text-right tabular-nums">{serie.values[index] === null ? "—" : format(serie.values[index]!)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
