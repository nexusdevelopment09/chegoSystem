// Filters of the store lists (home, search, category). Pure functions.
import type { StoreSummary } from "./queries";

export type StoreFilterParams = {
  aberto?: string;
  gratis?: string;
  retirada?: string;
  nota?: string;
};

export const FILTER_LABELS: Record<keyof StoreFilterParams, string> = {
  aberto: "Abertas agora",
  gratis: "Entrega grátis",
  retirada: "Retirada",
  nota: "Melhor avaliadas",
};

/** Keeps the fair default order; "nota" is the only filter that reorders, by rating. */
export function applyStoreFilters(stores: StoreSummary[], params: StoreFilterParams): StoreSummary[] {
  let result = stores;
  if (params.aberto) result = result.filter((store) => store.availability.state === "open");
  if (params.gratis) result = result.filter((store) => (store.area?.feeCents ?? store.minFeeCents) === 0);
  if (params.retirada) result = result.filter((store) => store.offersPickup);
  if (params.nota) {
    result = result
      .filter((store) => store.ratingCount >= 5)
      .sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0));
  }
  return result;
}
