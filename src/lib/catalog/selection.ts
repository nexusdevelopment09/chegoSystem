// The customer's choices for a product: validation, price and how they are
// written on the cart, the order and the printed ticket. Pure functions,
// shared by the browser (live total) and the server (the price that counts).
import { itemUnitPriceCents, type ChosenGroup, type PriceMode } from "./pricing.ts";

export type OptionView = {
  id: string;
  name: string;
  /** Sub-heading inside the group: "Tradicionais", "Especiais"... */
  label: string | null;
  /** Price of this option on this product. */
  priceCents: number;
  available: boolean;
};

export type GroupView = {
  id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
  allowRepeat: boolean;
  mode: PriceMode;
  freeQuantity: number;
  options: OptionView[];
};

/** In the order the customer picked them. */
export type Pick = { groupId: string; optionId: string; quantity: number };

export type ResolvedPick = { option: OptionView; quantity: number };
export type ResolvedGroup = { group: GroupView; picks: ResolvedPick[]; units: number };

export type SelectionResult =
  | { ok: true; groups: ResolvedGroup[]; unitPriceCents: number }
  | { ok: false; error: string; groupId: string | null };

const minimumOf = (group: GroupView) => Math.max(group.min, group.required ? 1 : 0);

/** How many units were picked in a group. */
export function unitsIn(picks: Pick[], groupId: string): number {
  return picks.filter((pick) => pick.groupId === groupId).reduce((total, pick) => total + pick.quantity, 0);
}

/** What is still missing in a group, or null when it is complete. */
export function groupProblem(group: GroupView, units: number): string | null {
  const min = minimumOf(group);
  if (units < min) {
    return min === group.max
      ? `Escolha ${min} em “${group.name}”`
      : `Escolha pelo menos ${min} em “${group.name}”`;
  }
  if (units > group.max) return `Escolha no máximo ${group.max} em “${group.name}”`;
  return null;
}

/** Checks the picks against the product's groups and prices the item. */
export function resolveSelection(basePriceCents: number, groups: GroupView[], picks: Pick[]): SelectionResult {
  const resolved: ResolvedGroup[] = [];

  for (const pick of picks) {
    const group = groups.find((item) => item.id === pick.groupId);
    const option = group?.options.find((item) => item.id === pick.optionId);
    if (!group || !option) return { ok: false, error: "Essa opção não existe mais. Atualize a página.", groupId: pick.groupId };
    if (!option.available) return { ok: false, error: `“${option.name}” esgotou.`, groupId: group.id };
    if (!Number.isInteger(pick.quantity) || pick.quantity < 1) {
      return { ok: false, error: "Quantidade inválida.", groupId: group.id };
    }
    if (pick.quantity > 1 && !group.allowRepeat) {
      return { ok: false, error: `Em “${group.name}” não dá para repetir a mesma opção.`, groupId: group.id };
    }
  }

  for (const group of groups) {
    const groupPicks = picks.filter((pick) => pick.groupId === group.id);
    const seen = new Set(groupPicks.map((pick) => pick.optionId));
    if (seen.size !== groupPicks.length) {
      return { ok: false, error: `Opção repetida em “${group.name}”.`, groupId: group.id };
    }
    const units = groupPicks.reduce((total, pick) => total + pick.quantity, 0);
    const problem = groupProblem(group, units);
    if (problem) return { ok: false, error: problem, groupId: group.id };

    resolved.push({
      group,
      units,
      picks: groupPicks.map((pick) => ({
        option: group.options.find((option) => option.id === pick.optionId)!,
        quantity: pick.quantity,
      })),
    });
  }

  return { ok: true, groups: resolved, unitPriceCents: priceOf(basePriceCents, resolved) };
}

function priceOf(basePriceCents: number, groups: ResolvedGroup[]): number {
  const chosen: ChosenGroup[] = groups.map(({ group, picks }) => ({
    mode: group.mode,
    freeQuantity: group.freeQuantity,
    choices: picks.map((pick) => ({ priceCents: pick.option.priceCents, quantity: pick.quantity })),
  }));
  return itemUnitPriceCents(basePriceCents, chosen);
}

/** Live total while the customer is still choosing: prices whatever is picked so far. */
export function partialPriceCents(basePriceCents: number, groups: GroupView[], picks: Pick[]): number {
  const partial: ResolvedGroup[] = groups.map((group) => {
    const resolved = picks
      .filter((pick) => pick.groupId === group.id)
      .flatMap((pick) => {
        const option = group.options.find((item) => item.id === pick.optionId);
        return option ? [{ option, quantity: pick.quantity }] : [];
      });
    return { group, picks: resolved, units: resolved.reduce((total, pick) => total + pick.quantity, 0) };
  });
  return priceOf(basePriceCents, partial);
}

/** The lowest price the product can have: "a partir de R$ 45,00". */
export function startingPriceCents(basePriceCents: number, groups: GroupView[]): number {
  let total = basePriceCents;
  for (const group of groups) {
    const min = minimumOf(group);
    if (min === 0) continue;
    const prices = group.options.filter((option) => option.available).map((option) => option.priceCents).sort((a, b) => a - b);
    if (prices.length === 0) continue;
    if (group.mode === "highest" || group.mode === "average") total += prices[0];
    else if (group.mode === "free_up_to") total += Math.max(0, min - group.freeQuantity) * prices[0];
    else total += group.allowRepeat ? prices[0] * min : prices.slice(0, min).reduce((sum, price) => sum + price, 0);
  }
  return total;
}

export type SnapshotOption = { groupName: string; optionName: string; mode: PriceMode; quantity: number };

/**
 * Lines written under the item on the cart, the order and the ticket:
 *   1/2 Calabresa
 *   1/2 Carne de Sol com Queijo Coalho
 *   Borda: Catupiry
 */
export function describeOptions(options: SnapshotOption[]): string[] {
  const lines: string[] = [];
  const groupNames = [...new Set(options.map((option) => option.groupName))];

  for (const groupName of groupNames) {
    const inGroup = options.filter((option) => option.groupName === groupName);
    const units = inGroup.reduce((total, option) => total + option.quantity, 0);
    const shared = inGroup[0].mode === "highest" || inGroup[0].mode === "average";

    if (shared) {
      // Flavors share the item in equal parts.
      for (const option of inGroup) {
        lines.push(units === 1 ? option.optionName : `${option.quantity}/${units} ${option.optionName}`);
      }
    } else {
      const names = inGroup.map((option) => (option.quantity > 1 ? `${option.quantity}x ${option.optionName}` : option.optionName));
      lines.push(`${groupName}: ${names.join(", ")}`);
    }
  }
  return lines;
}

export function toSnapshot(groups: ResolvedGroup[]): (SnapshotOption & { optionId: string; priceCents: number })[] {
  return groups.flatMap(({ group, picks }) =>
    picks.map((pick) => ({
      groupName: group.name, optionName: pick.option.name, mode: group.mode,
      quantity: pick.quantity, optionId: pick.option.id, priceCents: pick.option.priceCents,
    })),
  );
}
