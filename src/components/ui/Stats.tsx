import type { ReactNode } from "react";

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-card bg-white p-4 ring-1 ring-peach" data-testid="stat">
      <p className="text-sm text-coffee-soft">{label}</p>
      <p className="font-display text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-coffee-soft">{hint}</p>}
    </div>
  );
}

/** Um gráfico de barras horizontais simples, feito de elementos comuns: leve e legível por leitores de tela. */
export function Bars({ rows, format }: { rows: { label: string; value: number }[]; format: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
          <span className="text-coffee-soft">{row.label}</span>
          <span className="h-4 rounded-full bg-cream" aria-hidden="true">
            <span className="block h-4 rounded-full bg-brand" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </span>
          <span className="font-semibold tabular-nums">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}
