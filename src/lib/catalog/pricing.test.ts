import { describe, expect, it } from "vitest";
import { groupPriceCents, itemUnitPriceCents } from "./pricing";

const one = (priceCents: number) => ({ priceCents, quantity: 1 });

describe("groupPriceCents", () => {
  it("sum adds every option, respecting quantity", () => {
    expect(groupPriceCents({ mode: "sum", choices: [one(400), { priceCents: 300, quantity: 2 }] })).toBe(1000);
  });

  it("highest charges the most expensive option", () => {
    expect(groupPriceCents({ mode: "highest", choices: [one(4500), one(5600)] })).toBe(5600);
  });

  it("average charges the mean, rounded to the cent", () => {
    expect(groupPriceCents({ mode: "average", choices: [one(4500), one(5600)] })).toBe(5050);
    expect(groupPriceCents({ mode: "average", choices: [one(100), one(100), one(101)] })).toBe(100);
  });

  it("free_up_to gives the first N picks for free", () => {
    const five = [one(100), one(100), one(100), one(100), one(100)];
    expect(groupPriceCents({ mode: "free_up_to", freeQuantity: 4, choices: five.slice(0, 4) })).toBe(0);
    expect(groupPriceCents({ mode: "free_up_to", freeQuantity: 4, choices: five })).toBe(100);
    expect(
      groupPriceCents({ mode: "free_up_to", freeQuantity: 4, choices: [{ priceCents: 100, quantity: 6 }] }),
    ).toBe(200);
  });

  it("an empty group costs nothing in every mode", () => {
    for (const mode of ["sum", "highest", "average", "free_up_to"] as const) {
      expect(groupPriceCents({ mode, choices: [] })).toBe(0);
    }
  });
});

describe("itemUnitPriceCents", () => {
  const calabresa = one(4500);
  const carneDeSol = one(5600);
  const bordaCatupiry = { mode: "sum" as const, choices: [one(800)] };

  it("Pizza Grande meio a meio, regra do maior valor: R$ 56,00", () => {
    expect(itemUnitPriceCents(0, [{ mode: "highest", choices: [calabresa, carneDeSol] }])).toBe(5600);
  });

  it("Pizza Grande meio a meio, regra da média: R$ 50,50", () => {
    expect(itemUnitPriceCents(0, [{ mode: "average", choices: [calabresa, carneDeSol] }])).toBe(5050);
  });

  it("adds the crust on top of the flavors", () => {
    expect(
      itemUnitPriceCents(0, [{ mode: "highest", choices: [calabresa, carneDeSol] }, bordaCatupiry]),
    ).toBe(6400);
  });

  it("açaí: base price, 5 free-up-to-4 toppings and a paid extra", () => {
    const toppings = { mode: "free_up_to" as const, freeQuantity: 4, choices: Array.from({ length: 5 }, () => one(100)) };
    const extras = { mode: "sum" as const, choices: [one(400)] };
    expect(itemUnitPriceCents(1600, [toppings, extras])).toBe(2100);
  });
});
