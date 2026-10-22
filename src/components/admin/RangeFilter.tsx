import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { RANGE_PRESETS, type Range } from "@/lib/admin/range";

/**
 * Filtro de período (e de cidade) de todas as telas do super admin, numa linha acima dos números.
 * `keep`: outros filtros da página, mantidos ao trocar o período.
 */
export function RangeFilter({ path, range, cities, cityId, keep = {} }: {
  path: string; range: Range; cities: { id: string; name: string }[]; cityId: string | null; keep?: Record<string, string | undefined>;
}) {
  const base = Object.fromEntries(Object.entries({ ...keep, cidade: cityId ?? undefined }).filter((entry): entry is [string, string] => !!entry[1]));
  const link = (query: Record<string, string>) => `${path}?${new URLSearchParams({ ...base, ...query })}`;
  return (
    <div className="flex flex-col gap-2" data-testid="range-filter">
      <nav aria-label="Período" className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((preset) => (
          <Link key={preset.key} href={link({ periodo: preset.key })} aria-current={range.key === preset.key ? "true" : undefined}
            className={buttonClass(range.key === preset.key ? "primary" : "secondary", "min-h-11 px-3 text-sm")}>{preset.label}</Link>
        ))}
      </nav>
      <form method="get" action={path} className="flex flex-wrap items-end gap-2">
        {Object.entries(keep).map(([key, value]) => value && <input key={key} type="hidden" name={key} value={value} />)}
        <label className="flex flex-col gap-1 text-xs font-semibold">De<input type="date" name="de" defaultValue={range.key === "personalizado" ? range.firstDay : ""} className={`${inputClass} min-h-11 w-auto`} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Até<input type="date" name="ate" defaultValue={range.key === "personalizado" ? range.lastDay : ""} className={`${inputClass} min-h-11 w-auto`} /></label>
        {cities.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-semibold">Cidade
            <select name="cidade" defaultValue={cityId ?? ""} className={`${inputClass} min-h-11 w-auto`}>
              <option value="">Todas</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </label>
        )}
        {cities.length <= 1 && cityId && <input type="hidden" name="cidade" value={cityId} />}
        <button type="submit" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Aplicar</button>
      </form>
      <p className="text-sm text-coffee-soft" data-testid="range-label">
        {range.label} · comparado com {range.previous.label}
      </p>
    </div>
  );
}
