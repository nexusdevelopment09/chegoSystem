import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Um número do painel. Com `href`, o cartão inteiro vira um link para a lista
 * já filtrada que explica aquele número.
 */
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const content = (
    <>
      <p className="text-sm text-coffee-soft">{label}</p>
      <p className="font-display text-2xl font-semibold break-words">{value}</p>
      {hint && <p className="text-xs text-coffee-soft">{hint}</p>}
      {href && <p className="mt-1 text-xs font-bold text-brand-dark underline">Ver detalhes</p>}
    </>
  );
  const box = "block h-full min-w-0 rounded-card bg-white p-4 ring-1 ring-peach";
  return href
    ? <Link href={href} data-testid="stat" className={`${box} transition-shadow hover:ring-2 hover:ring-brand-dark`}>{content}</Link>
    : <div data-testid="stat" className={box}>{content}</div>;
}

/** Um gráfico de barras horizontais simples, feito de elementos comuns: leve e legível por leitores de tela. */
export function Bars({ rows, format }: { rows: { label: string; value: number; href?: string }[]; format: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
          {row.href
            ? <Link href={row.href} className="truncate font-semibold text-brand-dark underline">{row.label}</Link>
            : <span className="truncate text-coffee-soft">{row.label}</span>}
          <span className="h-4 rounded-full bg-cream" aria-hidden="true">
            <span className="block h-4 rounded-full bg-brand" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </span>
          <span className="font-semibold tabular-nums">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}
