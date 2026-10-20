// Filtros e ordenação das listas de lojas (início, busca, categoria). Funções puras.
//
// Filtro tira lojas da lista (abertas, entrega grátis, retirada, com ofertas); ordenação
// só muda a ordem, e nunca esconde ninguém. Quem não tem o dado de uma ordenação (sem
// entrega no bairro, sem avaliações suficientes) vai para o fim, na ordem padrão.
import type { StoreSummary } from "./queries";

export type StoreFilterParams = {
  aberto?: string;
  gratis?: string;
  retirada?: string;
  ofertas?: string;
  ordem?: string;
  /** Antigos (links já compartilhados): viram ordem=nota e ordem=tempo. */
  nota?: string;
  rapidas?: string;
};

export const FILTER_LABELS = {
  aberto: "Abertas agora",
  gratis: "Entrega grátis",
  retirada: "Retirada",
  ofertas: "Com ofertas",
} as const;

export type FilterKey = keyof typeof FILTER_LABELS;
export const FILTER_KEYS = Object.keys(FILTER_LABELS) as FilterKey[];

export const SORT_LABELS = {
  relevancia: "Recomendados",
  tempo: "Menor tempo de entrega",
  taxa: "Menor taxa de entrega",
  nota: "Melhor avaliação",
  promocoes: "Promoções primeiro",
} as const;

export type SortKey = keyof typeof SORT_LABELS;
export const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

/** Lojas precisam de pelo menos tantas avaliações para entrar na ordem por nota. */
export const MIN_RATINGS_TO_RANK = 5;

/** A ordenação pedida, aceitando os parâmetros antigos. */
export function sortOf(params: StoreFilterParams): SortKey {
  if (params.ordem && params.ordem in SORT_LABELS) return params.ordem as SortKey;
  if (params.nota) return "nota";
  if (params.rapidas) return "tempo";
  return "relevancia";
}

/** Algum filtro ligado, ou uma ordenação diferente da padrão? */
export const hasActiveFilters = (params: Record<string, string | undefined>) =>
  FILTER_KEYS.some((key) => Boolean(params[key])) || sortOf(params) !== "relevancia";

/** Menor tempo previsto até a entrega, em minutos (preparo + movimento + trajeto até o bairro). */
export function fastestMinutes(store: StoreSummary): number {
  return store.prepMinutes + store.busyExtraMinutes + (store.area?.minMinutes ?? 0);
}

/** Ordena pelo valor (menor primeiro); quem não tem valor (null) fica no fim. Estável. */
function sortBy(stores: StoreSummary[], value: (store: StoreSummary) => number | null): StoreSummary[] {
  return stores
    .map((store, index) => ({ store, index, value: value(store) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) return Number(a.value === null) - Number(b.value === null) || a.index - b.index;
      return a.value - b.value || a.index - b.index;
    })
    .map(({ store }) => store);
}

export type FilterContext = {
  /** Lojas com produto em oferta ou cupom próprio válido. */
  offerStoreIds?: Set<string>;
};

/** Aplica os filtros e a ordenação sobre a ordem padrão justa (listStores). */
export function applyStoreFilters(stores: StoreSummary[], params: StoreFilterParams, context: FilterContext = {}): StoreSummary[] {
  const offers = context.offerStoreIds ?? new Set<string>();
  let result = stores;
  if (params.aberto) result = result.filter((store) => store.availability.state === "open");
  if (params.gratis) result = result.filter((store) => store.offersDelivery && (store.area?.feeCents ?? store.minFeeCents) === 0);
  if (params.retirada) result = result.filter((store) => store.offersPickup);
  if (params.ofertas) result = result.filter((store) => offers.has(store.id));

  switch (sortOf(params)) {
    case "tempo":
      // Só tem prazo quem entrega no bairro do cliente.
      return sortBy(result, (store) => (store.offersDelivery && store.area ? fastestMinutes(store) : null));
    case "taxa":
      return sortBy(result, (store) => (store.offersDelivery && store.area ? store.area.feeCents : null));
    case "nota":
      return sortBy(result, (store) => (store.ratingCount >= MIN_RATINGS_TO_RANK && store.ratingAvg !== null ? -store.ratingAvg : null));
    case "promocoes":
      return sortBy(result, (store) => (offers.has(store.id) ? 0 : null));
    default:
      return result;
  }
}
