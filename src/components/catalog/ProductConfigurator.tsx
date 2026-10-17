"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { addToCart, cartConflict } from "@/lib/cart/local";
import {
  describeOptions, groupProblem, partialPriceCents, resolveSelection, toSnapshot, unitsIn,
  type GroupView, type OptionView, type Pick,
} from "@/lib/catalog/selection";
import { formatWeight, gramsToQuantity, weightPriceCents } from "@/lib/catalog/weight";
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
  /** Vendido por peso: precisão em gramas, preço do quilo e o mínimo de gramas. */
  weightStepGrams: number | null;
  pricePerKgCents: number | null;
  weightMinGrams: number | null;
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
  const [units, setUnits] = useState(1);
  // Por peso: o cliente digita os gramas (ou usa os botões); começa no mínimo da loja.
  const weight = product.weightStepGrams && product.pricePerKgCents
    ? { step: product.weightStepGrams, min: product.weightMinGrams ?? product.weightStepGrams, perKg: product.pricePerKgCents }
    : null;
  const [gramsText, setGramsText] = useState(weight ? String(weight.min) : "");
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
  const maxQuantity = product.maxPerOrder ?? (weight ? 100_000 : 99);
  const grams = weight ? Number.parseInt(gramsText || "0", 10) : 0;
  const gramsCheck = weight ? gramsToQuantity(grams, { stepGrams: weight.step, minGrams: weight.min }) : null;
  const quantity = gramsCheck ? (gramsCheck.ok ? gramsCheck.quantity : 0) : units;
  const weightError = gramsCheck && !gramsCheck.ok
    ? gramsCheck.error
    : weight && quantity > maxQuantity ? `O máximo por pedido é ${formatWeight(maxQuantity * weight.step)}.` : null;
  const disabledReason = blockedReason ?? (result.ok ? weightError : result.error);
  const total = weight ? (gramsCheck?.ok ? weightPriceCents(weight.perKg, grams) : 0) : unitPrice * units;
  // Os botões de peso andam de 50 em 50 g (ou na precisão da loja, se ela for maior).
  const jump = weight ? Math.max(weight.step, Math.ceil(50 / weight.step) * weight.step) : 1;
  const nudge = (delta: number) => {
    if (!weight) return;
    const current = Number.isFinite(grams) && grams > 0 ? grams : weight.min;
    const next = Math.max(weight.min, Math.round((current + delta) / weight.step) * weight.step);
    setGramsText(String(next));
  };

  function add(replace: boolean) {
    if (!result.ok || disabledReason) return;
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
        lines: describeOptions(toSnapshot(result.groups)), weightStepGrams: product.weightStepGrams,
        pricePerKgCents: product.pricePerKgCents, weightMinGrams: product.weightMinGrams,
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
        {weight && (
          <p className="text-center text-sm text-coffee-soft" data-testid="weight-price">
            {formatCents(weight.perKg)} o kg · mínimo {formatWeight(weight.min)}, de {weight.step} em {weight.step} g.
            {" "}A loja pesa na hora: o valor final pode variar um pouco.
          </p>
        )}
        <div className="flex items-center gap-3">
          {weight ? (
            <div className="flex items-center gap-1 rounded-full bg-white px-1 ring-1 ring-peach">
              <StepButton label={`Menos ${jump} g`} disabled={!Number.isFinite(grams) || grams <= weight.min} onClick={() => nudge(-jump)}>−</StepButton>
              <label className="flex items-baseline gap-1 font-bold">
                <span className="sr-only">Quantos gramas</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={weight.min}
                  step={weight.step}
                  value={gramsText}
                  onChange={(event) => setGramsText(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  data-testid="grams"
                  aria-label="Quantos gramas"
                  className="w-16 rounded-lg bg-cream px-1 py-1 text-center text-base font-bold focus:outline-none focus:ring-2 focus:ring-brand-dark"
                />
                <span aria-hidden="true">g</span>
              </label>
              <StepButton label={`Mais ${jump} g`} disabled={quantity >= maxQuantity} onClick={() => nudge(jump)}>+</StepButton>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-white px-2 ring-1 ring-peach">
              <StepButton label="Diminuir quantidade" disabled={units <= 1} onClick={() => setUnits(units - 1)}>−</StepButton>
              <span className="w-6 text-center font-bold" data-testid="quantity">{units}</span>
              <StepButton label="Aumentar quantidade" disabled={units >= maxQuantity} onClick={() => setUnits(units + 1)}>+</StepButton>
            </div>
          )}
          <Button type="button" className="flex-1 whitespace-nowrap px-4" disabled={disabledReason !== null} onClick={() => add(false)}>
            Adicionar • {formatCents(total)}
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
