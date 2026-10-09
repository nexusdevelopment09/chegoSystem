import { describe, expect, it } from "vitest";
import {
  describeOptions, partialPriceCents, resolveSelection, startingPriceCents, toSnapshot,
  type GroupView, type OptionView, type Pick,
} from "./selection";

const option = (id: string, name: string, priceCents = 0, extra: Partial<OptionView> = {}): OptionView => ({
  id, name, label: null, priceCents, available: true, ...extra,
});
const group = (id: string, name: string, options: OptionView[], extra: Partial<GroupView> = {}): GroupView => ({
  id, name, required: false, min: 0, max: 1, allowRepeat: false, mode: "sum", freeQuantity: 0, options, ...extra,
});
const pick = (groupId: string, optionId: string, quantity = 1): Pick => ({ groupId, optionId, quantity });

// Pizza Grande (8 fatias): até 2 sabores, borda opcional.
const flavors = (mode: "highest" | "average") =>
  group("sabores", "Sabores", [
    option("calabresa", "Calabresa", 4500),
    option("carne", "Carne de Sol com Queijo Coalho", 5600),
    option("camarao", "Camarão", 5600, { available: false }),
    option("mussarela", "Mussarela", 4500),
  ], { required: true, min: 1, max: 2, mode });
const crust = group("bordas", "Borda", [option("catupiry", "Catupiry", 800), option("chocolate", "Chocolate", 900)]);

describe("pizza Grande meio a meio", () => {
  const halfAndHalf = [pick("sabores", "calabresa"), pick("sabores", "carne")];

  it("charges the most expensive flavor: R$ 56,00", () => {
    const result = resolveSelection(0, [flavors("highest"), crust], halfAndHalf);
    expect(result).toMatchObject({ ok: true, unitPriceCents: 5600 });
  });

  it("charges the average when the store uses that rule: R$ 50,50", () => {
    const result = resolveSelection(0, [flavors("average"), crust], halfAndHalf);
    expect(result).toMatchObject({ ok: true, unitPriceCents: 5050 });
  });

  it("adds the crust and writes the lines of the ticket", () => {
    const result = resolveSelection(0, [flavors("highest"), crust], [...halfAndHalf, pick("bordas", "catupiry")]);
    if (!result.ok) throw new Error(result.error);
    expect(result.unitPriceCents).toBe(6400);
    expect(describeOptions(toSnapshot(result.groups))).toEqual([
      "1/2 Calabresa",
      "1/2 Carne de Sol com Queijo Coalho",
      "Borda: Catupiry",
    ]);
  });

  it("a single flavor is written without the fraction", () => {
    const result = resolveSelection(0, [flavors("highest"), crust], [pick("sabores", "mussarela")]);
    if (!result.ok) throw new Error(result.error);
    expect(describeOptions(toSnapshot(result.groups))).toEqual(["Mussarela"]);
  });

  it("refuses too many flavors, no flavor, a sold-out flavor and two crusts", () => {
    const groups = [flavors("highest"), crust];
    expect(resolveSelection(0, groups, [])).toMatchObject({ ok: false, error: "Escolha pelo menos 1 em “Sabores”" });
    expect(resolveSelection(0, groups, [...halfAndHalf, pick("sabores", "mussarela")])).toMatchObject({
      ok: false, error: "Escolha no máximo 2 em “Sabores”",
    });
    expect(resolveSelection(0, groups, [pick("sabores", "camarao")])).toMatchObject({ ok: false, error: "“Camarão” esgotou." });
    expect(resolveSelection(0, groups, [pick("sabores", "calabresa"), pick("bordas", "catupiry"), pick("bordas", "chocolate")])).toMatchObject({
      ok: false, error: "Escolha no máximo 1 em “Borda”",
    });
  });

  it("refuses repeated options, invented options and bad quantities", () => {
    const groups = [flavors("highest"), crust];
    expect(resolveSelection(0, groups, [pick("sabores", "calabresa", 2)]).ok).toBe(false);
    expect(resolveSelection(0, groups, [pick("sabores", "calabresa"), pick("sabores", "calabresa")]).ok).toBe(false);
    expect(resolveSelection(0, groups, [pick("sabores", "inventado")]).ok).toBe(false);
    expect(resolveSelection(0, groups, [pick("outro-grupo", "calabresa")]).ok).toBe(false);
    expect(resolveSelection(0, groups, [pick("sabores", "calabresa", 0)]).ok).toBe(false);
    expect(resolveSelection(0, groups, [pick("sabores", "calabresa", 1.5)]).ok).toBe(false);
  });

  it("shows a starting price and a live partial total", () => {
    expect(startingPriceCents(0, [flavors("highest"), crust])).toBe(4500);
    expect(partialPriceCents(0, [flavors("highest"), crust], [pick("bordas", "chocolate")])).toBe(900);
  });
});

describe("açaí", () => {
  const toppings = group("complementos", "Complementos",
    ["Granola", "Leite em pó", "Banana", "Paçoca", "Amendoim"].map((name) => option(name, name, 100)),
    { max: 8, mode: "free_up_to", freeQuantity: 4 });
  const base = group("base", "Base", [option("puro", "Açaí puro"), option("banana", "Açaí com banana")], { required: true, min: 1, max: 1 });
  const extras = group("adicionais", "Adicionais", [option("avela", "Creme de avelã", 400)], { max: 6 });

  it("four toppings are free and the fifth costs R$ 1,00", () => {
    const four = ["Granola", "Leite em pó", "Banana", "Paçoca"].map((name) => pick("complementos", name));
    expect(resolveSelection(1600, [base, toppings, extras], [pick("base", "puro"), ...four])).toMatchObject({ ok: true, unitPriceCents: 1600 });
    expect(resolveSelection(1600, [base, toppings, extras], [pick("base", "puro"), ...four, pick("complementos", "Amendoim"), pick("adicionais", "avela")])).toMatchObject({
      ok: true, unitPriceCents: 2100,
    });
  });

  it("the base is mandatory", () => {
    expect(resolveSelection(1600, [base, toppings, extras], [])).toMatchObject({ ok: false, error: "Escolha 1 em “Base”", groupId: "base" });
  });
});

describe("quentinha and hambúrguer", () => {
  const sides = group("acompanhamentos", "Acompanhamentos",
    ["Arroz", "Feijão", "Macarrão", "Farofa"].map((name) => option(name, name)),
    { required: true, min: 3, max: 3 });
  const size = group("tamanho", "Tamanho", [option("p", "P"), option("g", "G", 500)], { required: true, min: 1, max: 1 });

  it("needs exactly 3 side dishes", () => {
    const two = [pick("tamanho", "g"), pick("acompanhamentos", "Arroz"), pick("acompanhamentos", "Feijão")];
    expect(resolveSelection(1500, [size, sides], two)).toMatchObject({ ok: false, error: "Escolha 3 em “Acompanhamentos”" });
    const three = [...two, pick("acompanhamentos", "Farofa")];
    const result = resolveSelection(1500, [size, sides], three);
    if (!result.ok) throw new Error(result.error);
    expect(result.unitPriceCents).toBe(2000);
    expect(describeOptions(toSnapshot(result.groups))).toEqual(["Tamanho: G", "Acompanhamentos: Arroz, Feijão, Farofa"]);
  });

  it("repeats an option when the group allows it", () => {
    const snacks = group("salgados", "Salgados", [option("coxinha", "Coxinha", 500), option("risole", "Risole", 500)], { max: 4, allowRepeat: true });
    const result = resolveSelection(0, [snacks], [pick("salgados", "coxinha", 2), pick("salgados", "risole")]);
    if (!result.ok) throw new Error(result.error);
    expect(result.unitPriceCents).toBe(1500);
    expect(describeOptions(toSnapshot(result.groups))).toEqual(["Salgados: 2x Coxinha, Risole"]);
    expect(resolveSelection(0, [snacks], [pick("salgados", "coxinha", 5)])).toMatchObject({ ok: false });
  });

  it("sums paid extras on a burger", () => {
    const point = group("ponto", "Ponto da carne", [option("ao-ponto", "Ao ponto"), option("bem", "Bem passado")], { required: true, min: 1, max: 1 });
    const addOns = group("adicionais", "Adicionais", [option("bacon", "Bacon", 400), option("ovo", "Ovo", 200)], { max: 5 });
    const combo = group("combo", "Transformar em combo?", [option("combo", "Batata média + refrigerante lata", 1000)]);
    expect(resolveSelection(2200, [point, addOns, combo], [pick("ponto", "ao-ponto"), pick("adicionais", "bacon"), pick("adicionais", "ovo"), pick("combo", "combo")])).toMatchObject({
      ok: true, unitPriceCents: 3800,
    });
  });
});
