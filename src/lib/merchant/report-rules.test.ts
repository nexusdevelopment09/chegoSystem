import { describe, expect, it } from "vitest";
import { pendingCents, receivedCents, SEGMENTS, segmentRows, summarize, type ReportOrder, type Segment } from "./report-rules";

const AT = new Date("2026-10-09T15:00:00-03:00");
let counter = 0;
function order(overrides: Partial<ReportOrder>): ReportOrder {
  counter += 1;
  return {
    id: `o${counter}`, code: `JG-${counter}`, paidAt: new Date("2026-10-09T12:00:00-03:00"), status: "delivered", fulfillment: "delivery",
    paymentMethod: "cash", collection: "store", customerName: "Cliente", neighborhood: "Centro", totalCents: 5000, refundedCents: 0,
    deliveryFeeCents: 300, discountCents: 0, storeDiscountCents: 0, storeAmountCents: 0, refundedFromStoreCents: 0,
    acceptedAt: new Date("2026-10-09T12:05:00-03:00"), readyAt: new Date("2026-10-09T12:35:00-03:00"),
    channel: "app", subtotalCents: 4700, itemsCount: 1, platformFeeCents: 0, costCents: null, ...overrides,
  };
}

describe("relatórios: a receber", () => {
  it("dinheiro ou cartão na entrega: em andamento está a receber; entregue já foi recebido", () => {
    const going = order({ status: "out_for_delivery", paymentMethod: "card" });
    expect(pendingCents(going, AT)).toBe(5000);
    expect(receivedCents(going, AT)).toBe(0);
    const done = order({ status: "delivered" });
    expect(pendingCents(done, AT)).toBe(0);
    expect(receivedCents(done, AT)).toBe(5000);
  });

  it("Pix direto à loja nunca conta como pendente (o Chegô não vê o Pix cair)", () => {
    expect(pendingCents(order({ status: "preparing", paymentMethod: "pix" }), AT)).toBe(0);
  });

  it("recusado, cancelado e reembolsado nunca estão a receber", () => {
    for (const status of ["rejected", "cancelled", "refunded"]) {
      expect(pendingCents(order({ status, paymentMethod: "cash" }), AT)).toBe(0);
      expect(receivedCents(order({ status }), AT)).toBe(0);
    }
  });

  it("pago pelo app: a receber até o repasse (2 dias úteis), já descontado o reembolso da loja", () => {
    const fresh = order({ collection: "app", paymentMethod: "pix", storeAmountCents: 4400, refundedFromStoreCents: 400 });
    expect(pendingCents(fresh, AT)).toBe(4000);
    const old = order({ collection: "app", paidAt: new Date("2026-09-01T12:00:00-03:00"), storeAmountCents: 4400 });
    expect(pendingCents(old, AT)).toBe(0);
    expect(receivedCents(old, AT)).toBe(4400);
  });
});

describe("relatórios: o número do indicador é a soma da listagem", () => {
  const orders = [
    order({ status: "delivered" }), order({ status: "picked_up", fulfillment: "pickup", deliveryFeeCents: 0 }),
    order({ status: "preparing", paymentMethod: "cash" }), order({ status: "accepted", paymentMethod: "pix" }),
    order({ status: "rejected" }), order({ status: "cancelled" }), order({ status: "partially_refunded", refundedCents: 1000 }),
    order({ status: "delivered", discountCents: 500 }), order({ status: "refunded", refundedCents: 5000 }),
  ];
  const summary = summarize(orders, AT);

  it.each([
    ["vendidos", () => summary.sold], ["concluidos", () => summary.completed], ["andamento", () => summary.inProgress],
    ["cancelados", () => summary.cancelled], ["a_receber", () => summary.pending], ["recebidos", () => summary.received],
    ["entrega", () => summary.deliveryFees], ["descontos", () => summary.discounts],
  ] as [Segment, () => { count: number; totalCents: number }][])("%s", (segment, indicator) => {
    const { rows, count, totalCents } = segmentRows(orders, segment, AT);
    expect(indicator()).toEqual({ count, totalCents });
    const info = SEGMENTS[segment];
    if (info.amount) expect(rows.reduce((sum, row) => sum + info.amount!(row, AT), 0)).toBe(totalCents);
  });

  it("valores conferidos à mão", () => {
    // Vendidos: 9 pedidos menos recusado, cancelado e reembolsado = 6; 5 × 50 + 40 (parcial) = 290.
    expect(summary.sold).toEqual({ count: 6, totalCents: 29_000 });
    expect(summary.ticketCents).toBe(Math.round(29_000 / 6));
    expect(summary.pending).toEqual({ count: 1, totalCents: 5_000 }); // só o em preparo em dinheiro
    expect(summary.cancelled.count).toBe(2);
    expect(summary.refusalRate).toBeCloseTo(2 / 9);
    expect(summary.avgAcceptMinutes).toBe(5);
    expect(summary.byDay).toEqual([{ day: "2026-10-09", count: 6, totalCents: 29_000 }]);
  });
});

import { change, equivalentCutoff, financials, previousPeriod, summarizeYears } from "./report-rules";

describe("relatórios: comparação de períodos", () => {
  it("período anterior equivalente", () => {
    expect(previousPeriod("2026-10-18", "2026-10-18", "hoje")).toMatchObject({ from: "2026-10-17", to: "2026-10-17", label: "ontem" });
    expect(previousPeriod("2026-10-12", "2026-10-18", "7")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    // Este mês (1 a 31/03) × os mesmos dias do mês anterior, que só tem 28.
    expect(previousPeriod("2026-03-01", "2026-03-31", "mes")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-01-01", "2026-10-18", "ano")).toMatchObject({ from: "2025-01-01", to: "2025-10-18" });
    // 29/02 num ano bissexto vira 28/02 no ano anterior.
    expect(previousPeriod("2028-02-29", "2028-02-29", "ano")).toMatchObject({ from: "2027-02-28", to: "2027-02-28" });
  });

  it("sem base no período anterior não há percentual", () => {
    expect(change(150, 100)).toEqual({ pct: 50, direction: "up" });
    expect(change(80, 100)).toEqual({ pct: -20, direction: "down" });
    expect(change(100, 0)).toEqual({ pct: null, direction: "new" });
    expect(change(0, 0)).toEqual({ pct: null, direction: "none" });
  });
});

describe("relatórios: resultado financeiro (definições documentadas)", () => {
  it("bruto, descontos, estornos, vendas, taxa e receita líquida; margem só com custo", () => {
    const orders = [
      order({ subtotalCents: 4700, deliveryFeeCents: 300, discountCents: 500, totalCents: 4500, platformFeeCents: 50, costCents: 2000, itemsCount: 2, status: "delivered" }),
      order({ subtotalCents: 1000, deliveryFeeCents: 0, totalCents: 1000, refundedCents: 1000, status: "refunded", platformFeeCents: 0 }),
      order({ subtotalCents: 2000, deliveryFeeCents: 0, totalCents: 2000, status: "picked_up", platformFeeCents: 50, channel: "mesa", fulfillment: "pickup", paymentMethod: "cash" }),
    ];
    const money = financials(orders);
    expect(money.grossCents).toBe(4700 + 300 + 2000);
    expect(money.discountCents).toBe(500);
    expect(money.refundCents).toBe(1000);
    expect(money.salesCents).toBe(4500 + 2000);
    expect(money.platformFeeCents).toBe(100);
    expect(money.netOperatingCents).toBe(6400);
    expect(money.costCents).toBe(2000);
    expect(money.marginCents).toBe(4500 - 2000);
    expect(money.byChannel.map((row) => row.channel).sort()).toEqual(["delivery", "mesa"]);
  });
});

describe("relatório anual", () => {
  it("ano sem pedido aparece sem dados, e mês sem pedido fica vazio (não zero)", () => {
    const rows = [
      { year: 2026, month: 1, received: 3, sold: 2, completed: 2, cancelled: 1, salesCents: 10_000, grossCents: 11_000, discountCents: 0, refundCents: 0, items: 4, feeCents: 100 },
      { year: 2026, month: 3, received: 5, sold: 5, completed: 5, cancelled: 0, salesCents: 30_000, grossCents: 30_000, discountCents: 0, refundCents: 0, items: 9, feeCents: 250 },
    ];
    const [y2026, y2025] = summarizeYears(rows, [2026, 2025]);
    expect(y2026).toMatchObject({ hasData: true, sold: 7, salesCents: 40_000, ticketCents: 5714, netOperatingCents: 39_650, bestMonth: { month: 3 }, worstMonth: { month: 1 } });
    expect(y2026.months[1]).toBeNull();
    expect(y2025.hasData).toBe(false);
  });

  it("ano corrente na comparação: recorte no mesmo dia de cada ano", () => {
    expect(equivalentCutoff([2026, 2025], "2026-10-18")).toEqual({ month: 10, day: 18 });
    expect(equivalentCutoff([2025, 2024], "2026-10-18")).toBeNull();
    expect(equivalentCutoff([2026], "2026-10-18")).toBeNull();
  });
});
