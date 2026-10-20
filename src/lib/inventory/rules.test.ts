import { describe, expect, it } from "vitest";
import { daysUntil, estimateConsumption, expiryStatus, formatQuantity, parseQuantity, replenishment, soldAmount, stockLevel } from "./rules";

describe("estoque: situação e quantidades", () => {
  it("estoque baixo pelo mínimo cadastrado", () => {
    expect(stockLevel(0, 5)).toBe("zerado");
    expect(stockLevel(1.5, 5)).toBe("baixo"); // calabresa 1,5 kg com mínimo de 5 kg
    expect(stockLevel(3, 5)).toBe("repor");
    expect(stockLevel(80, 50)).toBe("normal"); // caixas de pizza
    expect(stockLevel(2, 0)).toBe("normal"); // sem mínimo cadastrado não inventa alerta
  });

  it("números no formato brasileiro, nos dois sentidos", () => {
    expect(formatQuantity(1.5, "kg")).toBe("1,5 kg");
    expect(formatQuantity(80, "un")).toBe("80 un.");
    expect(parseQuantity("1,5")).toBe(1.5);
    expect(parseQuantity("1.250,75")).toBe(1250.75);
    expect(parseQuantity("0.15")).toBe(0.15);
    expect(parseQuantity("abc")).toBeNull();
    expect(parseQuantity("")).toBeNull();
  });

  it("venda por peso sai do estoque na unidade do item", () => {
    expect(soldAmount(41, 10, "kg")).toBe(0.41);
    expect(soldAmount(41, 10, "g")).toBe(410);
    expect(soldAmount(3, null, "un")).toBe(3);
  });
});

describe("estoque: validade (datas de Maceió)", () => {
  const warn = [30, 15, 7, 3];
  it("vencido, vence hoje, urgente, atenção e no prazo", () => {
    expect(daysUntil("2026-10-20", "2026-10-18")).toBe(2);
    expect(expiryStatus("2026-10-17", "2026-10-18", warn)).toBe("vencido");
    expect(expiryStatus("2026-10-18", "2026-10-18", warn)).toBe("vence_hoje");
    expect(expiryStatus("2026-10-21", "2026-10-18", warn)).toBe("urgente");
    expect(expiryStatus("2026-11-10", "2026-10-18", warn)).toBe("atencao");
    expect(expiryStatus("2027-01-01", "2026-10-18", warn)).toBe("ok");
    expect(expiryStatus(null, "2026-10-18", warn)).toBe("sem_validade");
  });
});

describe("estoque: consumo pela ficha técnica", () => {
  const recipe = [
    { productId: "massa", optionId: null, itemId: "farinha", quantity: 0.3 },
    { productId: "massa", optionId: "calabresa", itemId: "calabresa", quantity: 0.2 },
    { productId: "massa", optionId: "calabresa", itemId: "mussarela", quantity: 0.15 },
    { productId: "massa", optionId: "frango", itemId: "frango", quantity: 0.2 },
    { productId: "massa", optionId: "frango", itemId: "mussarela", quantity: 0.15 },
  ];

  it("45 pizzas de calabresa: consumo = ficha × quantidade", () => {
    const sold = [{ productId: "massa", quantity: 45, options: [{ optionId: "calabresa", quantity: 1, groupChoices: 1, split: true }] }];
    const use = estimateConsumption(sold, recipe);
    expect(use.get("calabresa")).toBe(9);
    expect(use.get("mussarela")).toBe(6.75);
    expect(use.get("farinha")).toBe(13.5);
  });

  it("meio a meio: cada sabor conta pela metade", () => {
    const sold = [{ productId: "massa", quantity: 2, options: [
      { optionId: "calabresa", quantity: 1, groupChoices: 2, split: true },
      { optionId: "frango", quantity: 1, groupChoices: 2, split: true },
    ] }];
    const use = estimateConsumption(sold, recipe);
    expect(use.get("calabresa")).toBe(0.2);
    expect(use.get("frango")).toBe(0.2);
    expect(use.get("mussarela")).toBe(0.3);
  });

  it("sem ficha técnica, nenhum consumo é inventado", () => {
    expect(estimateConsumption([{ productId: "refrigerante", quantity: 10, options: [] }], recipe).size).toBe(0);
  });
});

describe("estoque: sugestão de reposição", () => {
  it("usa o consumo real, o prazo do fornecedor e o ideal", () => {
    const result = replenishment({ quantity: 2, minQuantity: 5, idealQuantity: 20, leadTimeDays: 2, out7: 14, outPrev7: 10, out30: 45, coverDays: 7 });
    expect(result.dailyAverage).toBe(2); // max(14/7, 45/30)
    expect(result.trend).toBe("subindo");
    expect(result.daysLeft).toBe(1);
    expect(result.safetyStock).toBe(9); // mínimo 5 + 2 dias × 2
    expect(result.suggested).toBe(21); // alvo = max(20, 9 + 7 × 2 = 23) − 2
    expect(result.reason).toContain("Consumo médio de 2 por dia");
  });

  it("sem consumo registrado: só pelo mínimo e o ideal, e diz que é limitado", () => {
    const result = replenishment({ quantity: 1, minQuantity: 5, idealQuantity: null, leadTimeDays: null, out7: 0, outPrev7: 0, out30: 0, coverDays: 7 });
    expect(result.suggested).toBe(4);
    expect(result.trend).toBe("sem_dados");
    expect(result.reason).toContain("Sem consumo registrado");
    expect(replenishment({ quantity: 10, minQuantity: 5, idealQuantity: null, leadTimeDays: null, out7: 0, outPrev7: 0, out30: 0, coverDays: 7 }).suggested).toBe(0);
  });
});
