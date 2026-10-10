import Link from "next/link";
import { FILTER_LABELS, type StoreFilterParams } from "@/lib/stores/filters";

type Props = {
  /** Página para onde os filtros levam, ex.: "/busca" ou "/categoria/lanches". */
  basePath: string;
  /** Valores atuais da query string, incluindo os que não são filtros (q, categoria). */
  params: Record<string, string | undefined>;
};

/** Filtros como links comuns: funcionam sem JavaScript e podem ser compartilhados. */
export function FilterChips({ basePath, params }: Props) {
  const href = (key: keyof StoreFilterParams) => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value && name !== key) next.set(name, value);
    }
    if (!params[key]) next.set(key, "1");
    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav aria-label="Filtros" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {(Object.keys(FILTER_LABELS) as (keyof StoreFilterParams)[]).map((key) => (
        <Link
          key={key}
          href={href(key)}
          aria-current={params[key] ? "true" : undefined}
          className={`flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold ring-1 ${
            params[key] ? "bg-brand-dark text-white ring-brand-dark" : "bg-white text-coffee ring-peach"
          }`}
        >
          {FILTER_LABELS[key]}
        </Link>
      ))}
    </nav>
  );
}
