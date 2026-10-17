import { describe, expect, it } from "vitest";
import { applyStoreFilters, hasActiveFilters } from "./filters";
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

describe("filtros da lista de lojas", () => {
  it("'Mais rápidas' ordena pelo tempo previsto e deixa de fora quem só faz retirada", () => {
    const stores = [
      store("Lenta", { prepMinutes: 40 }),
      store("Rápida", { prepMinutes: 10 }),
      store("Movimentada", { prepMinutes: 10, busyExtraMinutes: 30 }),
      store("Só retirada", { prepMinutes: 5, offersDelivery: false, offersPickup: true }),
    ];
    expect(applyStoreFilters(stores, { rapidas: "1" }).map((item) => item.name)).toEqual(["Rápida", "Lenta", "Movimentada"]);
  });

  it("sem filtro, a ordem justa não muda; com algum, a página sabe que está filtrando", () => {
    const stores = [store("B"), store("A")];
    expect(applyStoreFilters(stores, {}).map((item) => item.name)).toEqual(["B", "A"]);
    expect(hasActiveFilters({ q: "pizza" })).toBe(false);
    expect(hasActiveFilters({ gratis: "1" })).toBe(true);
  });
});
