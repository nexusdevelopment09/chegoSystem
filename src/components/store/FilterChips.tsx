import Link from "next/link";
import { HScroller } from "@/components/ui/HScroller";
import { Icon } from "@/components/ui/Icon";
import { FILTER_KEYS, FILTER_LABELS, hasActiveFilters, SORT_KEYS, SORT_LABELS, sortOf, type FilterKey } from "@/lib/stores/filters";

type Props = {
  /** Página para onde os filtros levam, ex.: "/busca" ou "/categoria/lanches". */
  basePath: string;
  /** Valores atuais da query string, incluindo os que não são filtros (q, sub). */
  params: Record<string, string | undefined>;
  /** Filtros que fazem sentido nesta lista (ex.: "Com ofertas" só quando há ofertas). */
  keys?: FilterKey[];
};

export const chipClass = (active: boolean) =>
  `flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold ring-1 transition-colors ${
    active ? "bg-brand-dark text-white ring-brand-dark" : "bg-white text-coffee ring-peach hover:ring-brand"
  }`;

/** Monta o link mantendo os outros parâmetros da página. */
export function linkWith(basePath: string, params: Record<string, string | undefined>, change: (next: URLSearchParams) => void) {
  const next = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) next.set(name, value);
  change(next);
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Ordenação (menu "Ordenar") e filtros (chips) como links comuns: funcionam sem
 * JavaScript, podem ser compartilhados e trocam a lista sem recarregar a página nem
 * pular para o topo. Trocar a ordenação mantém os filtros, e vice-versa.
 */
export function FilterChips({ basePath, params, keys = FILTER_KEYS }: Props) {
  const withParams = (change: (next: URLSearchParams) => void) => linkWith(basePath, params, change);
  const toggle = (key: FilterKey) => withParams((next) => (params[key] ? next.delete(key) : next.set(key, "1")));
  const clear = withParams((next) => [...FILTER_KEYS, "ordem", "nota", "rapidas"].forEach((key) => next.delete(key)));
  const sort = sortOf(params);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* key: fecha o menu ao trocar a ordenação. */}
      <details key={sort} className="group relative shrink-0">
        <summary className={`${chipClass(sort !== "relevancia")} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-testid="sort-menu">
          <Icon name="sort" size={16} />
          <span className="hidden sm:inline">{sort === "relevancia" ? "Ordenar" : SORT_LABELS[sort]}</span>
          <span className="sm:hidden">{sort === "relevancia" ? "Ordenar" : "Ordem"}</span>
          <Icon name="chevronDown" size={14} className="transition-transform group-open:rotate-180" />
        </summary>
        <ul aria-label="Ordenar por" className="absolute left-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-2xl bg-white py-1 shadow-xl ring-1 ring-peach">
          {SORT_KEYS.map((key) => (
            <li key={key}>
              <Link
                href={withParams((next) => { next.delete("nota"); next.delete("rapidas"); if (key === "relevancia") next.delete("ordem"); else next.set("ordem", key); })}
                scroll={false}
                aria-current={sort === key ? "true" : undefined}
                className={`flex min-h-11 items-center justify-between gap-2 px-4 text-sm ${sort === key ? "font-bold text-brand-dark" : "hover:bg-cream"}`}
              >
                {SORT_LABELS[key]}
                {sort === key && <Icon name="check" size={16} strokeWidth={2.5} />}
              </Link>
            </li>
          ))}
        </ul>
      </details>

      <div className="min-w-0 flex-1">
        <HScroller label="Filtros" listClassName="gap-2" compact bleed={false}>
          {keys.map((key) => (
            <li key={key} className="shrink-0">
              <Link href={toggle(key)} scroll={false} aria-current={params[key] ? "true" : undefined} className={chipClass(Boolean(params[key]))}>
                {FILTER_LABELS[key]}
              </Link>
            </li>
          ))}
          {hasActiveFilters(params) && (
            <li className="shrink-0">
              <Link href={clear} scroll={false} className="flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-brand-dark underline">
                Limpar filtros
              </Link>
            </li>
          )}
        </HScroller>
      </div>
    </div>
  );
}
