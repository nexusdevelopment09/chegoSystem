import { describe, expect, it } from "vitest";
import { applyStoreFilters, hasActiveFilters, sortOf } from "./filters";
import type { StoreSummary } from "./queries";

function store(name: string, overrides: Partial<StoreSummary> = {}): StoreSummary {
  return {
    id: name, slug: name, name, description: "", logoUrl: null, coverUrl: null, categoryName: "Lanches", categorySlug: "lanches",
    ratingAvg: 4.5, ratingCount: 10, minOrderCents: 0, prepMinutes: 20, busyExtraMinutes: 0, offersDelivery: true,
    offersPickup: false, acceptsScheduled: false, featured: false, createdAt: new Date("2026-01-01"),
    availability: { state: "open", label: "Aberta" } as StoreSummary["availability"],
    area: { feeCents: 300, minMinutes: 10, maxMinutes: 20 }, minFeeCents: 300, shifts: [],
    ...overrides,
  };
}
const names = (list: StoreSummary[]) => list.map((item) => item.name);

describe("filtros e ordenação da lista de lojas", () => {
  it("menor tempo: ordena pelo prazo; quem só faz retirada ou não entrega no bairro vai para o fim", () => {
    const stores = [
      store("Lenta", { prepMinutes: 40 }),
      store("Só retirada", { prepMinutes: 5, offersDelivery: false, offersPickup: true }),
      store("Rápida", { prepMinutes: 10 }),
      store("Fora do bairro", { prepMinutes: 1, area: null }),
      store("Movimentada", { prepMinutes: 10, busyExtraMinutes: 30 }),
    ];
    expect(names(applyStoreFilters(stores, { ordem: "tempo" }))).toEqual(["Rápida", "Lenta", "Movimentada", "Só retirada", "Fora do bairro"]);
    // Link antigo "Mais rápidas" continua funcionando.
    expect(sortOf({ rapidas: "1" })).toBe("tempo");
  });

  it("menor taxa não é o mesmo que entrega grátis, e taxa desconhecida não conta como zero", () => {
    const stores = [
      store("Cara", { area: { feeCents: 800, minMinutes: 10, maxMinutes: 20 } }),
      store("Sem bairro", { area: null, minFeeCents: 500 }),
      store("Grátis", { area: { feeCents: 0, minMinutes: 10, maxMinutes: 20 } }),
      store("Barata", { area: { feeCents: 300, minMinutes: 10, maxMinutes: 20 } }),
    ];
    expect(names(applyStoreFilters(stores, { ordem: "taxa" }))).toEqual(["Grátis", "Barata", "Cara", "Sem bairro"]);
    expect(names(applyStoreFilters(stores, { gratis: "1" }))).toEqual(["Grátis"]);
  });

  it("melhor avaliação: poucas avaliações vão para o fim, sem sumir", () => {
    const stores = [store("Nova", { ratingAvg: 5, ratingCount: 2 }), store("Boa", { ratingAvg: 4.2 }), store("Ótima", { ratingAvg: 4.9 })];
    expect(names(applyStoreFilters(stores, { ordem: "nota" }))).toEqual(["Ótima", "Boa", "Nova"]);
  });

  it("ofertas: o filtro tira quem não tem; a ordenação só põe na frente", () => {
    const stores = [store("A"), store("B"), store("C")];
    const offerStoreIds = new Set(["C"]);
    expect(names(applyStoreFilters(stores, { ofertas: "1" }, { offerStoreIds }))).toEqual(["C"]);
    expect(names(applyStoreFilters(stores, { ordem: "promocoes" }, { offerStoreIds }))).toEqual(["C", "A", "B"]);
  });

  it("sem filtro, a ordem justa não muda; com filtro ou ordenação, a página sabe que está filtrando", () => {
    const stores = [store("B"), store("A")];
    expect(names(applyStoreFilters(stores, {}))).toEqual(["B", "A"]);
    expect(names(applyStoreFilters(stores, { ordem: "qualquer-coisa" }))).toEqual(["B", "A"]);
    expect(hasActiveFilters({ q: "pizza" })).toBe(false);
    expect(hasActiveFilters({ ordem: "relevancia" })).toBe(false);
    expect(hasActiveFilters({ gratis: "1" })).toBe(true);
    expect(hasActiveFilters({ ordem: "taxa" })).toBe(true);
  });
});
