import Link from "next/link";
import { inputClass } from "@/components/ui/Field";
import { filtersToParams, MODALITIES, PRESETS, STATUS_FILTERS, type Preset, type ReportFilters } from "@/lib/merchant/report-data";

const PAYMENT_LABELS = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;
const brDate = (value: string) => value.split("-").reverse().join("/");

/**
 * Filtros dos relatórios: período (atalhos ou datas), situação, bairro, pagamento,
 * entrega ou retirada, produto, cliente e número do pedido. Formulário GET comum: tudo
 * fica no endereço, então voltar, recarregar e compartilhar mantêm os filtros.
 */
export function ReportFilterBar({ basePath, filters, neighborhoods, segment, showSearch = false, staff = [] }: {
  basePath: string;
  /** Funcionários da loja, para o filtro por responsável (só para quem pode gerenciar a equipe). */
  staff?: { id: string; name: string }[];
  filters: ReportFilters;
  neighborhoods: { id: string; name: string }[];
  /** Na listagem, o segmento escolhido segue junto com os filtros. */
  segment?: string;
  /** Busca por cliente e número do pedido (na listagem). */
  showSearch?: boolean;
}) {
  const presetLink = (preset: Preset) =>
    `${basePath}${filtersToParams({ ...filters, preset, from: "", to: "" }, { periodo: preset === "30" ? undefined : preset, segmento: segment })}`;
  const active: { label: string; remove: string }[] = [];
  const without = (patch: Partial<ReportFilters>) => `${basePath}${filtersToParams({ ...filters, ...patch }, { segmento: segment })}`;
  if (filters.status) active.push({ label: STATUS_FILTERS[filters.status], remove: without({ status: undefined }) });
  if (filters.bairro) active.push({ label: `Bairro: ${neighborhoods.find((hood) => hood.id === filters.bairro)?.name ?? "—"}`, remove: without({ bairro: undefined }) });
  if (filters.pagamento) active.push({ label: PAYMENT_LABELS[filters.pagamento], remove: without({ pagamento: undefined }) });
  if (filters.modalidade) active.push({ label: MODALITIES[filters.modalidade], remove: without({ modalidade: undefined }) });
  if (filters.funcionario) active.push({ label: `Funcionário: ${staff.find((person) => person.id === filters.funcionario)?.name ?? "—"}`, remove: without({ funcionario: undefined }) });
  if (filters.produto) active.push({ label: `Produto: ${filters.produto}`, remove: without({ produto: undefined }) });
  if (filters.cliente) active.push({ label: `Cliente: ${filters.cliente}`, remove: without({ cliente: undefined }) });
  if (filters.pedido) active.push({ label: `Pedido: ${filters.pedido}`, remove: without({ pedido: undefined }) });
  if (filters.hora !== undefined) active.push({ label: `Das ${filters.hora}h às ${filters.hora + 1}h`, remove: without({ hora: undefined }) });
  const clear = `${basePath}${segment ? `?segmento=${segment}` : ""}`;

  return (
    <section aria-label="Filtros do relatório" className="flex flex-col gap-3 rounded-card bg-white p-3 ring-1 ring-peach" data-testid="report-filters">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESETS) as Preset[]).map((preset) => (
          <Link key={preset} href={presetLink(preset)} aria-current={filters.preset === preset ? "true" : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-sm font-bold ring-1 ${filters.preset === preset ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach hover:ring-brand"}`}>
            {PRESETS[preset]}
          </Link>
        ))}
      </div>
      <form method="get" action={basePath} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {segment && <input type="hidden" name="segmento" value={segment} />}
        <label className="flex flex-col gap-1 text-xs font-semibold">De<input type="date" name="de" defaultValue={filters.from} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Até<input type="date" name="ate" defaultValue={filters.to} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Situação
          <select name="status" defaultValue={filters.status ?? ""} className={inputClass}>
            <option value="">Todas</option>
            {Object.entries(STATUS_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Bairro
          <select name="bairro" defaultValue={filters.bairro ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {neighborhoods.map((hood) => <option key={hood.id} value={hood.id}>{hood.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Pagamento
          <select name="pagamento" defaultValue={filters.pagamento ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {Object.entries(PAYMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Entrega, retirada ou mesa
          <select name="modalidade" defaultValue={filters.modalidade ?? ""} className={inputClass}>
            <option value="">Todas</option>
            {Object.entries(MODALITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {staff.length > 0 && (
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Funcionário
            <select name="funcionario" defaultValue={filters.funcionario ?? ""} className={inputClass}>
              <option value="">Todos</option>
              {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold">Produto<input name="produto" defaultValue={filters.produto ?? ""} maxLength={120} placeholder="Ex.: pizza" className={inputClass} /></label>
        {showSearch && (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold">Cliente (nome ou telefone)<input name="cliente" defaultValue={filters.cliente ?? ""} maxLength={60} className={inputClass} /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold">Número do pedido<input name="pedido" defaultValue={filters.pedido ?? ""} maxLength={30} placeholder="Ex.: JG-0402" className={inputClass} /></label>
          </>
        )}
        {filters.hora !== undefined && <input type="hidden" name="hora" value={filters.hora} />}
        <button type="submit" className="min-h-11 self-end rounded-full bg-brand-dark px-5 text-sm font-bold text-white">Aplicar filtros</button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="active-filters">
        <span className="font-semibold">{brDate(filters.from)}{filters.to !== filters.from && ` a ${brDate(filters.to)}`}</span>
        {active.map((item) => (
          <Link key={item.label} href={item.remove} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-peach px-3 font-semibold text-brand-darker" aria-label={`Tirar filtro ${item.label}`}>
            {item.label} <span aria-hidden="true">×</span>
          </Link>
        ))}
        {(active.length > 0 || filters.preset !== "30") && (
          <Link href={clear} className="inline-flex min-h-11 items-center px-2 font-semibold text-brand-dark underline">Limpar filtros</Link>
        )}
      </div>
    </section>
  );
}
