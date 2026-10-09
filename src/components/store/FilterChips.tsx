import Link from "next/link";
import { FILTER_LABELS, type StoreFilterParams } from "@/lib/stores/filters";

type Props = {
  /** Page the chips link to, e.g. "/busca" or "/categoria/lanches". */
  basePath: string;
  /** Current query string values, including ones that are not filters (q, categoria). */
  params: Record<string, string | undefined>;
};

/** Filter toggles as plain links: they work without JavaScript and can be shared. */
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
