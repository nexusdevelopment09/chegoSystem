import Link from "next/link";
import type { ReactNode } from "react";
import { variation } from "@/lib/admin/range";

/** Indicador: número, variação contra o período anterior e o valor anterior. Clicável quando há lista. */
export function Kpi({ label, value, current, previous, format, href, hint, inverse = false, testId }: {
  label: string; value: ReactNode; current?: number; previous?: number; format?: (value: number) => string;
  href?: string; hint?: string; inverse?: boolean; testId?: string;
}) {
  const change = current !== undefined && previous !== undefined ? variation(current, previous) : null;
  const good = change && (change.direction === "up" || change.direction === "down") ? (change.direction === "up") !== inverse : null;
  const content = (
    <>
      <p className="text-sm text-coffee-soft">{label}</p>
      <p className="font-display text-2xl font-semibold break-words tabular-nums">{value}</p>
      {change && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          {change.direction === "none" ? <span className="text-coffee-soft">sem dados nos dois períodos</span>
            : change.direction === "new" ? <span className="text-coffee-soft">sem base no período anterior</span>
            : <span className={`font-bold ${good === null ? "text-coffee-soft" : good ? "text-success" : "text-danger"}`}>
                {change.direction === "up" ? "▲" : change.direction === "down" ? "▼" : "="} {change.pct!.toLocaleString("pt-BR")}%
              </span>}
          {previous !== undefined && change.direction !== "none" && <span className="text-coffee-soft">antes: {format ? format(previous) : previous.toLocaleString("pt-BR")}</span>}
        </p>
      )}
      {hint && <p className="text-xs text-coffee-soft">{hint}</p>}
    </>
  );
  const box = "flex h-full min-w-0 flex-col gap-0.5 rounded-card bg-white p-4 ring-1 ring-peach";
  return href
    ? <Link href={href} data-testid={testId ?? "kpi"} className={`${box} transition-shadow hover:ring-2 hover:ring-brand-dark`}>{content}</Link>
    : <div data-testid={testId ?? "kpi"} className={box}>{content}</div>;
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
      <header className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-xl">{title}</h2>{action}</header>
      {children}
    </section>
  );
}
