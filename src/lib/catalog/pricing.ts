// Price of a menu item from its option groups. Pure functions, in cents.
// Also imported by the seed, so no Next.js or "@/" imports here.

export type PriceMode = "sum" | "highest" | "average" | "free_up_to";

export type ChosenOption = { priceCents: number; quantity: number };

export type ChosenGroup = {
  mode: PriceMode;
  /** For "free_up_to": how many choices cost nothing. */
  freeQuantity?: number;
  /** In the order the customer picked them. */
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
      // The first N picks are free; every pick after that pays its own price.
      return units.slice(group.freeQuantity ?? 0).reduce((total, price) => total + price, 0);
  }
}

/** Unit price of the item: base price plus what each option group adds. */
export function itemUnitPriceCents(basePriceCents: number, groups: ChosenGroup[]): number {
  return groups.reduce((total, group) => total + groupPriceCents(group), basePriceCents);
}
