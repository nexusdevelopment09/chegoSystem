import { describe, expect, it } from "vitest";
import { formatWeight, gramsToQuantity, quantityLabel, weightPriceCents } from "./weight";

describe("venda por peso", () => {
  it("mostra gramas e quilos do jeito brasileiro", () => {
    expect(formatWeight(110)).toBe("110 g");
    expect(formatWeight(1000)).toBe("1 kg");
    expect(formatWeight(1250)).toBe("1,25 kg");
    expect(formatWeight(2500)).toBe("2,5 kg");
  });

  it("cobra pelo preço do quilo, arredondando só no fim", () => {
    expect(weightPriceCents(3990, 100)).toBe(399);
    expect(weightPriceCents(3990, 110)).toBe(439); // 4,389 -> 4,39
    expect(weightPriceCents(3990, 1000)).toBe(3990); // 1 kg é exatamente o preço do quilo
    expect(weightPriceCents(4990, 250)).toBe(1248); // 12,475 -> 12,48
  });

  it("aceita qualquer quantidade na precisão da loja, a partir do mínimo", () => {
    const rules = { stepGrams: 10, minGrams: 100 };
    expect(gramsToQuantity(110, rules)).toEqual({ ok: true, quantity: 11 });
    expect(gramsToQuantity(275, { stepGrams: 5, minGrams: 50 })).toEqual({ ok: true, quantity: 55 });
    expect(gramsToQuantity(90, rules)).toEqual({ ok: false, error: "O mínimo é 100 g." });
    expect(gramsToQuantity(115, rules)).toEqual({ ok: false, error: "Escolha de 10 em 10 g." });
    expect(gramsToQuantity(0, rules)).toMatchObject({ ok: false });
  });

  it("quantidade: unidades viram '3x'; por peso, o total em gramas", () => {
    expect(quantityLabel(3, null)).toBe("3x");
    expect(quantityLabel(11, 10)).toBe("110 g");
    expect(quantityLabel(5, 250)).toBe("1,25 kg");
  });
});
