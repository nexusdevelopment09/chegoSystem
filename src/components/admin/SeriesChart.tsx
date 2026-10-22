"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";

// Colunas ao longo do tempo, uma série só (o título diz o que é, sem legenda). Mesma cor azul
// validada do relatório anual. Passar o mouse ou focar uma coluna mostra o valor; a tabela fica
// sempre a um clique, para quem não enxerga a cor ou usa leitor de tela.
const COLOR = "#2a78d6";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type SeriesPoint = { key: string; value: number };

function label(key: string): string {
  if (/^\d{2}$/.test(key)) return `${Number(key)}h`;
  if (/^\d{4}-\d{2}$/.test(key)) return `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

export function SeriesChart({ title, points, kind, testId }: { title: string; points: SeriesPoint[]; kind: "money" | "count"; testId?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const format = (value: number) => (kind === "money" ? formatCents(value) : value.toLocaleString("pt-BR"));
  const max = Math.max(1, ...points.map((point) => point.value));
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const width = 720;
  const height = 200;
  const slot = width / Math.max(1, points.length);
  const bar = Math.max(2, Math.min(28, slot - 2));
  // Rótulos do eixo: no máximo uns 12, para não encavalar.
  const every = Math.max(1, Math.ceil(points.length / 12));
  const shown = active ?? null;

  return (
    <figure className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-sm text-coffee-soft" aria-live="polite">
          {shown !== null ? <>{label(points[shown].key)}: <strong className="text-coffee">{format(points[shown].value)}</strong></> : <>Total: <strong className="text-coffee">{format(total)}</strong></>}
        </span>
      </figcaption>
      {total === 0 ? (
        <p className="rounded-2xl bg-cream p-6 text-center text-sm text-coffee-soft">Nenhum dado no período.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height + 22}`} className="h-auto w-full" role="group" aria-label={`${title}. Total ${format(total)}. Veja a tabela abaixo.`}>
          {[0.25, 0.5, 0.75, 1].map((step) => (
            <line key={step} x1={0} x2={width} y1={height - height * step} y2={height - height * step} stroke="currentColor" strokeOpacity={0.08} />
          ))}
          <line x1={0} x2={width} y1={height} y2={height} stroke="currentColor" strokeOpacity={0.25} />
          {points.map((point, index) => {
            const h = point.value === 0 ? 0 : Math.max(2, (point.value / max) * (height - 8));
            const x = index * slot + (slot - bar) / 2;
            return (
              <g key={point.key} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}
                tabIndex={0} role="img" aria-label={`${label(point.key)}: ${format(point.value)}`} className="outline-none">
                {/* Área de toque maior que a coluna. */}
                <rect x={index * slot} y={0} width={slot} height={height} fill="transparent" />
                {h > 0 && <path d={`M${x},${height} v${-(h - 4)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 v${h - 4} z`} fill={COLOR} opacity={active === null || active === index ? 1 : 0.45} />}
                {index % every === 0 && <text x={index * slot + slot / 2} y={height + 16} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.6}>{label(point.key)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer content-center text-coffee-soft">Ver em tabela</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full">
            <thead><tr className="text-left text-coffee-soft"><th className="py-1">Período</th><th className="text-right">Valor</th></tr></thead>
            <tbody>{points.map((point) => <tr key={point.key} className="border-t border-cream"><td className="py-1">{label(point.key)}</td><td className="text-right tabular-nums">{format(point.value)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
