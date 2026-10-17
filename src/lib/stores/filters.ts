// Filtros das listas de lojas (início, busca, categoria). Funções puras.
import type { StoreSummary } from "./queries";

export type StoreFilterParams = {
  aberto?: string;
  gratis?: string;
  retirada?: string;
  nota?: string;
  rapidas?: string;
};

export const FILTER_LABELS: Record<keyof StoreFilterParams, string> = {
  aberto: "Abertas agora",
  gratis: "Entrega grátis",
  retirada: "Retirada",
  nota: "Melhor avaliadas",
  rapidas: "Mais rápidas",
};

export const FILTER_KEYS = Object.keys(FILTER_LABELS) as (keyof StoreFilterParams)[];

/** Algum filtro ligado? */
export const hasActiveFilters = (params: Record<string, string | undefined>) => FILTER_KEYS.some((key) => Boolean(params[key]));

/** Menor tempo previsto até a entrega, em minutos (preparo + movimento + trajeto até o bairro). */
export function fastestMinutes(store: StoreSummary): number {
  return store.prepMinutes + store.busyExtraMinutes + (store.area?.minMinutes ?? 0);
}

/**
 * Mantém a ordem padrão justa; só "nota" e "rapidas" reordenam (pela avaliação e pelo
 * tempo de entrega). Juntos, a nota vem primeiro.
 */
export function applyStoreFilters(stores: StoreSummary[], params: StoreFilterParams): StoreSummary[] {
  let result = stores;
  if (params.aberto) result = result.filter((store) => store.availability.state === "open");
  if (params.gratis) result = result.filter((store) => (store.area?.feeCents ?? store.minFeeCents) === 0);
  if (params.retirada) result = result.filter((store) => store.offersPickup);
  if (params.rapidas) {
    result = result.filter((store) => store.offersDelivery).sort((a, b) => fastestMinutes(a) - fastestMinutes(b));
  }
  if (params.nota) {
    result = result
      .filter((store) => store.ratingCount >= 5)
      .sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0));
  }
  return result;
}
