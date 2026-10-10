"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { addToCart, cartConflict } from "@/lib/cart/local";
import {
  describeOptions, groupProblem, partialPriceCents, resolveSelection, toSnapshot, unitsIn,
  type GroupView, type OptionView, type Pick,
} from "@/lib/catalog/selection";
import { formatCents } from "@/lib/format";
import { PizzaPreview } from "./PizzaPreview";

export type ConfigurableProduct = {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  maxPerOrder: number | null;
  groups: GroupView[];
};

type Props = {
  product: ConfigurableProduct;
  /** Por que não pode ser pedido agora ("Esgotado", "Só até 10h"...), se for o caso. */
  blockedReason: string | null;
};

const isShared = (group: GroupView) => group.mode === "highest" || group.mode === "average";

function priceLabel(group: GroupView, option: OptionView, unitsPicked: number): string | null {
  if (isShared(group)) return formatCents(option.priceCents);
  if (option.priceCents === 0) return null;
  if (group.mode === "free_up_to" && unitsPicked < group.freeQuantity) return "grátis";
  return `+ ${formatCents(option.priceCents)}`;
}

export function ProductConfigurator({ product, blockedReason }: Props) {
  const router = useRouter();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);

  const quantityOf = (groupId: string, optionId: string) =>
    picks.find((pick) => pick.groupId === groupId && pick.optionId === optionId)?.quantity ?? 0;

  function change(group: GroupView, option: OptionView, delta: 1 | -1) {
    setPicks((current) => {
      const units = unitsIn(current, group.id);
      const existing = current.find((pick) => pick.groupId === group.id && pick.optionId === option.id);

      if (delta === -1) {
        if (!existing) return current;
        return existing.quantity > 1
          ? current.map((pick) => (pick === existing ? { ...pick, quantity: pick.quantity - 1 } : pick))
          : current.filter((pick) => pick !== existing);
      }
      // Uma escolha só: escolher outra opção substitui a atual.
      if (group.max === 1) {
        return [...current.filter((pick) => pick.groupId !== group.id), { groupId: group.id, optionId: option.id, quantity: 1 }];
      }
      if (units >= group.max) return current;
      if (existing) {
        return group.allowRepeat
          ? current.map((pick) => (pick === existing ? { ...pick, quantity: pick.quantity + 1 } : pick))
          : current;
      }
      return [...current, { groupId: group.id, optionId: option.id, quantity: 1 }];
    });
  }

  const result = resolveSelection(product.priceCents, product.groups, picks);
  const unitPrice = result.ok ? result.unitPriceCents : partialPriceCents(product.priceCents, product.groups, picks);
  const disabledReason = blockedReason ?? (result.ok ? null : result.error);
  const maxQuantity = product.maxPerOrder ?? 99;

  function add(replace: boolean) {
    if (!result.ok || blockedReason) return;
    const store = { storeId: product.storeId, storeSlug: product.storeSlug, storeName: product.storeName };
    if (!replace) {
      const other = cartConflict(store);
      if (other) return setConflict(other);
    }
    addToCart(
      store,
      {
        productId: product.id, name: product.name, imageUrl: product.imageUrl,
        unitPriceCents: result.unitPriceCents, quantity, notes: notes.trim(), picks,
        lines: describeOptions(toSnapshot(result.groups)),
      },
      replace,
    );
    router.push(`/loja/${product.storeSlug}`);
  }

  return (
    <div className="flex flex-col gap-5">
      {product.groups.map((group) => {
        const units = unitsIn(picks, group.id);
        const problem = groupProblem(group, units);
        const labels = [...new Set(group.options.map((option) => option.label))];
        const pickedNames = picks
          .filter((pick) => pick.groupId === group.id)
          .flatMap((pick) => {
            const option = group.options.find((item) => item.id === pick.optionId);
            return option ? Array.from({ length: pick.quantity }, () => option.name) : [];
          });

        return (
          <fieldset key={group.id} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-peach" data-testid={`group-${group.name}`}>
            <legend className="float-left mb-3 flex w-full flex-wrap items-center justify-between gap-2">
              <span className="font-display text-xl font-semibold">{group.name}</span>
              <span className="flex items-center gap-2 text-sm">
                <span className={`rounded-full px-3 py-1 font-bold ${problem ? "bg-peach text-brand-darker" : "bg-cream text-coffee-soft"}`}>
                  {group.required || group.min > 0 ? "Obrigatório" : "Opcional"}
                </span>
                <span className="font-semibold text-coffee-soft" aria-live="polite">
                  {units} de {group.max}
                </span>
              </span>
            </legend>

            <div className="clear-both flex flex-col gap-3">
              {isShared(group) && group.max > 1 && <PizzaPreview flavors={pickedNames} max={group.max} />}
              {isShared(group) && group.max > 1 && (
                <p className="rounded-2xl bg-cream px-3 py-2 text-sm text-coffee-soft">
                  {group.mode === "highest"
                    ? "Com mais de um sabor, cobramos o valor do sabor mais caro."
                    : "Com mais de um sabor, cobramos a média dos sabores."}
                </p>
              )}
              {group.mode === "free_up_to" && group.freeQuantity > 0 && (
                <p className="rounded-2xl bg-cream px-3 py-2 text-sm text-coffee-soft">
                  Os {group.freeQuantity} primeiros são grátis. Depois, cada um custa o valor ao lado.
                </p>
              )}

              {labels.map((label) => (
                <div key={label ?? "all"}>
                  {label && <p className="mb-1 mt-1 text-sm font-bold uppercase tracking-wide text-coffee-soft">{label}</p>}
                  <ul className="flex flex-col">
                    {group.options.filter((option) => option.label === label).map((option) => {
                      const picked = quantityOf(group.id, option.id);
                      const full = units >= group.max && group.max > 1 && picked === 0;
                      const price = priceLabel(group, option, units);
                      return (
                        <li key={option.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-cream py-1 last:border-0">
                          <span className={option.available ? "" : "text-coffee-soft line-through"}>
                            {option.name}
                            {!option.available && <span className="ml-2 text-sm font-semibold no-underline">Esgotado</span>}
                          </span>
                          <span className="flex shrink-0 items-center gap-3">
                            {price && <span className="text-sm text-coffee-soft">{price}</span>}
                            {group.allowRepeat && picked > 0 ? (
                              <span className="flex items-center gap-2">
                                <StepButton label={`Tirar um ${option.name}`} onClick={() => change(group, option, -1)}>−</StepButton>
                                <span className="w-5 text-center font-bold">{picked}</span>
                                <StepButton label={`Mais um ${option.name}`} disabled={units >= group.max} onClick={() => change(group, option, 1)}>+</StepButton>
                              </span>
                            ) : (
                              <button
                                type="button"
                                role={group.max === 1 ? "radio" : "checkbox"}
                                aria-checked={picked > 0}
                                aria-label={option.name}
                                disabled={!option.available || full}
                                onClick={() => change(group, option, picked > 0 && !(group.max === 1 && group.required) ? -1 : 1)}
                                className={`flex size-11 items-center justify-center rounded-full border-2 text-lg font-bold disabled:opacity-40 ${
                                  picked > 0 ? "border-brand-dark bg-brand-dark text-white" : "border-peach bg-white text-transparent"
                                }`}
                              >
                                ✓
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Alguma observação?
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value.slice(0, 140))}
          maxLength={140}
          rows={2}
          placeholder="Ex.: sem cebola, bem assada"
          className="rounded-2xl border-2 border-peach bg-white px-4 py-3 text-base font-normal focus:border-brand-dark focus:outline-none"
        />
        <span className="text-right text-xs font-normal text-coffee-soft">{notes.length}/140</span>
      </label>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-peach bg-cream px-4 py-3">
        {disabledReason && (
          <p role="status" className="text-center text-sm font-semibold text-brand-darker" data-testid="disabled-reason">
            {disabledReason}
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-white px-2 ring-1 ring-peach">
            <StepButton label="Diminuir quantidade" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>−</StepButton>
            <span className="w-6 text-center font-bold" data-testid="quantity">{quantity}</span>
            <StepButton label="Aumentar quantidade" disabled={quantity >= maxQuantity} onClick={() => setQuantity(quantity + 1)}>+</StepButton>
          </div>
          <Button type="button" className="flex-1" disabled={disabledReason !== null} onClick={() => add(false)}>
            Adicionar • {formatCents(unitPrice * quantity)}
          </Button>
        </div>
      </div>

      {conflict && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" className="fixed inset-0 z-20 flex items-end justify-center bg-coffee/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-card bg-white p-6">
            <h2 id="conflict-title" className="mb-2 text-xl">Começar um carrinho novo?</h2>
            <p className="mb-5 text-coffee-soft">
              Seu carrinho tem itens da {conflict}. Quer esvaziar e começar um novo?
            </p>
            <div className="flex flex-col gap-2">
              <Button type="button" onClick={() => add(true)}>Esvaziar e adicionar</Button>
              <Button type="button" variant="secondary" onClick={() => setConflict(null)}>Manter meu carrinho</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepButton({ label, children, ...props }: { label: string; children: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-full text-2xl font-bold text-brand-dark disabled:opacity-30"
      {...props}
    >
      {children}
    </button>
  );
}
