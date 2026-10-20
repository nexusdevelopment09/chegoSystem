import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { EXPIRY_LABELS, formatQuantity, LEVEL_LABELS, UNIT_LABELS, type ExpiryStatus, type StockLevel, type StockUnit } from "@/lib/inventory/rules";
import type { StockItem } from "@/lib/inventory/queries";
import { saveStockItem } from "./actions";

const TABS = [
  { href: "/lojista/estoque", label: "Itens" },
  { href: "/lojista/estoque/validade", label: "Validade" },
  { href: "/lojista/estoque/alertas", label: "Alertas" },
  { href: "/lojista/estoque/reposicao", label: "Reposição" },
  { href: "/lojista/estoque/movimentacoes", label: "Movimentações" },
];

/** Submenu do estoque; `current` é a aba aberta. */
export function StockNav({ current, counts }: { current: string; counts?: { alerts?: number; expiring?: number } }) {
  return (
    <nav aria-label="Estoque" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {TABS.map((tab) => {
        const badge = tab.label === "Alertas" ? counts?.alerts : tab.label === "Validade" ? counts?.expiring : undefined;
        const active = tab.href === current;
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 ${active ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach hover:ring-brand"}`}>
            {tab.label}
            {badge ? <span className={`rounded-full px-2 text-xs ${active ? "bg-white text-brand-darker" : "bg-danger text-white"}`}>{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

const LEVEL_TONE: Record<StockLevel, string> = {
  zerado: "bg-danger text-white", baixo: "bg-danger text-white", repor: "bg-peach text-brand-darker", normal: "bg-cream text-coffee",
};
export function LevelBadge({ level }: { level: StockLevel }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${LEVEL_TONE[level]}`} data-testid="stock-level">{LEVEL_LABELS[level]}</span>;
}

const EXPIRY_TONE: Record<ExpiryStatus, string> = {
  vencido: "bg-danger text-white", vence_hoje: "bg-danger text-white", urgente: "bg-danger text-white", atencao: "bg-peach text-brand-darker",
  ok: "bg-cream text-coffee", sem_validade: "bg-cream text-coffee-soft",
};
export function ExpiryBadge({ status, days }: { status: ExpiryStatus; days: number | null }) {
  const suffix = days === null || status === "sem_validade" ? "" : status === "vencido" ? ` há ${-days} dia${days === -1 ? "" : "s"}` : status === "vence_hoje" ? "" : ` em ${days} dia${days === 1 ? "" : "s"}`;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${EXPIRY_TONE[status]}`} data-testid="expiry-status">{EXPIRY_LABELS[status]}{suffix}</span>;
}

export const qty = (value: number, unit: StockUnit) => formatQuantity(value, unit);
const money = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
const num = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

/** Cadastro e edição de item. O saldo nunca é editado aqui: só o inicial, no cadastro. */
export function StockItemForm({ item, products, categories }: { item: StockItem | null; products: { id: string; name: string }[]; categories: string[] }) {
  return (
    <ActionForm action={saveStockItem} resetOnSuccess={item === null} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <Field label="Nome do produto ou insumo" name="name" required maxLength={120} defaultValue={item?.name ?? ""} placeholder="Ex.: Mussarela" />
      <Field label="Categoria" name="category" maxLength={60} defaultValue={item?.category ?? ""} list="stock-categories" placeholder="Ex.: Laticínios" />
      <datalist id="stock-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
      <Field label="Código interno (SKU)" name="sku" maxLength={40} defaultValue={item?.sku ?? ""} />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Unidade de medida
        <select name="unit" defaultValue={item?.unit ?? "un"} className={inputClass}>
          {(Object.keys(UNIT_LABELS) as StockUnit[]).map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit].long} ({UNIT_LABELS[unit].short})</option>)}
        </select>
      </label>
      {item === null && <Field label="Saldo inicial" name="initialQuantity" inputMode="decimal" placeholder="0" hint="Depois, o saldo só muda por entradas, saídas e ajustes." />}
      <Field label="Estoque mínimo" name="minQuantity" inputMode="decimal" defaultValue={num(item?.minQuantity ?? null)} placeholder="0" hint="Abaixo disso, o item entra nos alertas." />
      <Field label="Quantidade ideal" name="idealQuantity" inputMode="decimal" defaultValue={num(item?.idealQuantity ?? null)} hint="Até onde repor." />
      <Field label="Custo unitário (R$)" name="unitCost" inputMode="decimal" defaultValue={money(item?.unitCostCents ?? null)} />
      <Field label="Fornecedor" name="supplier" maxLength={120} defaultValue={item?.supplier ?? ""} />
      <Field label="Prazo do fornecedor (dias)" name="leadTimeDays" type="number" min={0} max={365} defaultValue={item?.leadTimeDays ?? ""} />
      <Field label="Local de armazenamento" name="storageLocation" maxLength={60} defaultValue={item?.storageLocation ?? ""} placeholder="Ex.: Freezer 1" />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Produto do cardápio (opcional)
        <select name="productId" defaultValue={item?.productId ?? ""} className={inputClass}>
          <option value="">Nenhum (é um insumo)</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <span className="text-xs font-normal text-coffee-soft">Ligado a um produto, o saldo anda junto com a venda e o produto esgota sozinho no zero.</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Situação
        <select name="status" defaultValue={item?.status ?? "ativo"} className={inputClass}>
          <option value="ativo">Ativo</option><option value="indisponivel">Indisponível</option><option value="inativo">Inativo</option>
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" name="perishable" defaultChecked={item?.perishable ?? false} className="size-5 accent-brand-dark" />
        Perecível (controla lotes e validade)
      </label>
      <SubmitButton className="self-start sm:col-span-2">{item ? "Salvar item" : "Cadastrar item"}</SubmitButton>
    </ActionForm>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p role="status" className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">{children}</p>;
}
