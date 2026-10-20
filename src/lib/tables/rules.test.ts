import { describe, expect, it } from "vitest";
import { billTotals, closeProblem, mainMethod, paymentProblem } from "./rules";

const items = [{ unitPriceCents: 3000, quantity: 2, cancelled: false }, { unitPriceCents: 800, quantity: 1, cancelled: true }];

describe("contas de mesa", () => {
  it("total sem os itens cancelados; pagamento parcial deixa saldo", () => {
    const totals = billTotals(items, [{ method: "pix", amountCents: 2500, cancelled: false }, { method: "card", amountCents: 9999, cancelled: true }]);
    expect(totals).toEqual({ totalCents: 6000, paidCents: 2500, remainingCents: 3500, changeCents: 0 });
    expect(closeProblem(totals)).toBe("Ainda falta receber 35,00.");
  });

  it("dinheiro pode passar (troco); Pix e cartão não", () => {
    const open = billTotals(items, [{ method: "pix", amountCents: 2500, cancelled: false }]);
    expect(paymentProblem(open, "card", 4000)).toContain("no máximo");
    expect(paymentProblem(open, "cash", 5000)).toBeNull();
    const paid = billTotals(items, [{ method: "pix", amountCents: 2500, cancelled: false }, { method: "cash", amountCents: 5000, cancelled: false }]);
    expect(paid).toMatchObject({ remainingCents: 0, changeCents: 1500 });
    expect(closeProblem(paid)).toBeNull();
    expect(paymentProblem(paid, "cash", 100)).toBe("A conta já está paga.");
  });

  it("não fecha vazia; forma principal é a de maior valor", () => {
    expect(closeProblem(billTotals([], []))).toBe("A conta não tem itens.");
    expect(mainMethod([{ method: "pix", amountCents: 1000, cancelled: false }, { method: "cash", amountCents: 3000, cancelled: false }, { method: "card", amountCents: 9000, cancelled: true }])).toBe("cash");
  });
});
