import Link from "next/link";
import { FILTER_KEYS, FILTER_LABELS, hasActiveFilters, type StoreFilterParams } from "@/lib/stores/filters";

type Props = {
  /** Página para onde os filtros levam, ex.: "/busca" ou "/categoria/lanches". */
  basePath: string;
  /** Valores atuais da query string, incluindo os que não são filtros (q, categoria). */
  params: Record<string, string | undefined>;
};

/**
 * Filtros como links comuns: funcionam sem JavaScript e podem ser compartilhados.
 * No celular, a faixa desliza de lado sem alargar a página.
 */
export function FilterChips({ basePath, params }: Props) {
  const withParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) if (value) next.set(name, value);
    change(next);
    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const toggle = (key: keyof StoreFilterParams) => withParams((next) => (params[key] ? next.delete(key) : next.set(key, "1")));
  const clear = withParams((next) => FILTER_KEYS.forEach((key) => next.delete(key)));
  const active = hasActiveFilters(params);

  return (
    <nav aria-label="Filtros" className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
      {FILTER_KEYS.map((key) => (
        <Link
          key={key}
          href={toggle(key)}
          aria-current={params[key] ? "true" : undefined}
          className={`flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold ring-1 transition-colors ${
            params[key] ? "bg-brand-dark text-white ring-brand-dark" : "bg-white text-coffee ring-peach hover:ring-brand"
          }`}
        >
          {FILTER_LABELS[key]}
        </Link>
      ))}
      {active && (
        <Link href={clear} className="flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-brand-dark underline">
          Limpar filtros
        </Link>
      )}
    </nav>
  );
}
