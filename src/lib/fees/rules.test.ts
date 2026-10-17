import { describe, expect, it } from "vitest";
import { addDays, businessDate, closingTotals } from "./rules";

describe("dia de expediente", () => {
  it("um pedido de madrugada ainda é do expediente da noite anterior", () => {
    // 1h30 de sábado em Maceió = 04h30 UTC.
    expect(businessDate(new Date("2026-10-10T01:30:00-03:00"), 5)).toBe("2026-10-09");
    expect(businessDate(new Date("2026-10-10T04:59:00-03:00"), 5)).toBe("2026-10-09");
  });

  it("vira o dia na hora de corte", () => {
    expect(businessDate(new Date("2026-10-10T05:00:00-03:00"), 5)).toBe("2026-10-10");
    expect(businessDate(new Date("2026-10-10T23:59:00-03:00"), 5)).toBe("2026-10-10");
  });

  it("sem corte, vale a data do calendário de Maceió", () => {
    expect(businessDate(new Date("2026-10-10T00:10:00-03:00"), 0)).toBe("2026-10-10");
  });

  it("soma dias atravessando o mês", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("totais do fechamento", () => {
  it("um pedido gera R$ 0,50 e cem pedidos geram R$ 50,00", () => {
    expect(closingTotals([{ kind: "order_fee", amountCents: 50 }]).netCents).toBe(50);
    const hundred = closingTotals(Array.from({ length: 100 }, () => ({ kind: "order_fee" as const, amountCents: 50 })));
    expect(hundred).toMatchObject({ orderCount: 100, feesCents: 5000, netCents: 5000 });
  });

  it("estorno tira a taxa e o pedido da contagem; créditos e ajustes entram separados", () => {
    const totals = closingTotals([
      { kind: "order_fee", amountCents: 50 },
      { kind: "order_fee", amountCents: 50 },
      { kind: "order_fee_reversal", amountCents: -50 },
      { kind: "coupon_credit", amountCents: -1000 },
      { kind: "adjustment", amountCents: 200 },
      { kind: "carryover", amountCents: -300 },
    ]);
    expect(totals).toEqual({ orderCount: 1, feesCents: 50, creditsCents: -1000, adjustmentsCents: -100, netCents: -1050 });
  });
});
