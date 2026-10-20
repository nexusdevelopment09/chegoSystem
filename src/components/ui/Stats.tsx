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
/**
 * Barras horizontais com o nome inteiro (quebra a linha quando é comprido, nunca corta) e o
 * valor sempre à vista; a barra fica embaixo, ocupando a largura toda.
 */
export function Bars({ rows, format }: { rows: { label: string; value: number; href?: string }[]; format: (value: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-2.5" data-testid="bars">
      {rows.map((row) => (
        <li key={row.label} className="flex flex-col gap-1 text-sm">
          <div className="flex items-start justify-between gap-3">
            {row.href
              ? <Link href={row.href} className="min-w-0 break-words font-semibold text-brand-dark underline">{row.label}</Link>
              : <span className="min-w-0 break-words text-coffee">{row.label}</span>}
            <span className="shrink-0 font-semibold tabular-nums">{format(row.value)}</span>
          </div>
          <span className="h-2.5 rounded-full bg-cream" aria-hidden="true">
            <span className="block h-2.5 rounded-full bg-brand-dark" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
