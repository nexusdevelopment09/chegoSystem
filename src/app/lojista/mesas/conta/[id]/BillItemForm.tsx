"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { groupProblem, partialPriceCents, unitsIn, type GroupView, type Pick } from "@/lib/catalog/selection";
import { formatCents } from "@/lib/format";
import { addItem, type ActionState } from "../../actions";

export type BillProduct = { id: string; name: string; section: string; priceCents: number; groups: GroupView[]; soldOut: boolean };

/** Adicionar item à conta: produto, escolhas obrigatórias (sabor, tamanho...), quantidade e observação. */
export function BillItemForm({ billId, products }: { billId: string; products: BillProduct[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addItem, {});
  const [productId, setProductId] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [query, setQuery] = useState("");
  const product = products.find((item) => item.id === productId);
  const visible = useMemo(() => products.filter((item) => !query || item.name.toLowerCase().includes(query.toLowerCase())), [products, query]);
  const problems = product ? product.groups.map((group) => groupProblem(group, unitsIn(picks, group.id))).filter(Boolean) : [];
  const price = product ? partialPriceCents(product.priceCents, product.groups, picks) : 0;

  const toggle = (group: GroupView, optionId: string) => {
    const has = picks.some((pick) => pick.groupId === group.id && pick.optionId === optionId);
    if (has) return setPicks(picks.filter((pick) => !(pick.groupId === group.id && pick.optionId === optionId)));
    // Grupo de uma escolha só: troca a escolha. Nos outros, para no máximo do grupo.
    if (group.max === 1) return setPicks([...picks.filter((pick) => pick.groupId !== group.id), { groupId: group.id, optionId, quantity: 1 }]);
    if (unitsIn(picks, group.id) >= group.max) return;
    setPicks([...picks, { groupId: group.id, optionId, quantity: 1 }]);
  };

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="bill-item-form">
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="picks" value={JSON.stringify(picks)} />
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <label className="flex flex-col gap-1 text-xs font-semibold">Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome do produto" className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Produto
          <select name="productId" value={productId} onChange={(event) => { setProductId(event.target.value); setPicks([]); }} required className={inputClass}>
            <option value="" disabled>Escolha</option>
            {visible.map((item) => <option key={item.id} value={item.id} disabled={item.soldOut}>{item.section} · {item.name} · {formatCents(item.priceCents)}{item.soldOut ? " (esgotado)" : ""}</option>)}
          </select>
        </label>
      </div>
      {product && product.groups.map((group) => (
        <fieldset key={group.id} className="rounded-2xl bg-cream p-3">
          <legend className="text-sm font-semibold">{group.name} {group.required || group.min > 0 ? <span className="text-xs text-coffee-soft">(obrigatório{group.max > 1 ? `, até ${group.max}` : ""})</span> : <span className="text-xs text-coffee-soft">(opcional{group.max > 1 ? `, até ${group.max}` : ""})</span>}</legend>
          <div className="flex flex-wrap gap-2">
            {group.options.map((option) => {
              const chosen = picks.some((pick) => pick.groupId === group.id && pick.optionId === option.id);
              return (
                <button key={option.id} type="button" disabled={!option.available} aria-pressed={chosen} onClick={() => toggle(group, option.id)}
                  className={`min-h-11 rounded-full px-3 text-sm ring-1 disabled:opacity-40 ${chosen ? "bg-brand-dark font-bold text-white ring-brand-dark" : "bg-white ring-peach"}`}>
                  {option.name}{option.priceCents > 0 && ` · ${formatCents(option.priceCents)}`}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-semibold">Quantidade<input name="quantity" type="number" min={1} max={99} defaultValue={1} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Observação<input name="notes" maxLength={200} placeholder="Ex.: sem cebola" className={inputClass} /></label>
        <Button type="submit" disabled={pending || !product || problems.length > 0} className="min-h-11 px-4 text-sm">
          {pending ? "Adicionando..." : product ? `Adicionar · ${formatCents(price)}` : "Adicionar"}
        </Button>
      </div>
      {problems.length > 0 && <p className="text-sm text-coffee-soft">{problems[0]}</p>}
      {state.error && <p role="alert" className="text-sm font-bold text-danger">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm font-semibold text-success">{state.message}</p>}
    </form>
  );
}
