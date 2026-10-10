// Preço de um item do cardápio a partir dos grupos de opções. Funções puras, em centavos.
// Também é importado pelo seed, então nada de Next.js nem de "@/" aqui.

export type PriceMode = "sum" | "highest" | "average" | "free_up_to";

export type ChosenOption = { priceCents: number; quantity: number };

export type ChosenGroup = {
  mode: PriceMode;
  /** Para "free_up_to": quantas escolhas não custam nada. */
  freeQuantity?: number;
  /** Na ordem em que o cliente escolheu. */
  choices: ChosenOption[];
};

export function groupPriceCents(group: ChosenGroup): number {
  const units = group.choices.flatMap((choice) =>
    Array.from({ length: choice.quantity }, () => choice.priceCents),
  );
  if (units.length === 0) return 0;

  switch (group.mode) {
    case "sum":
      return units.reduce((total, price) => total + price, 0);
    case "highest":
      return Math.max(...units);
    case "average":
      return Math.round(units.reduce((total, price) => total + price, 0) / units.length);
    case "free_up_to":
      // As N primeiras escolhas são grátis; cada escolha depois disso paga o próprio preço.
      return units.slice(group.freeQuantity ?? 0).reduce((total, price) => total + price, 0);
  }
}

/** Preço unitário do item: preço base mais o que cada grupo de opções acrescenta. */
export function itemUnitPriceCents(basePriceCents: number, groups: ChosenGroup[]): number {
  return groups.reduce((total, group) => total + groupPriceCents(group), basePriceCents);
}
