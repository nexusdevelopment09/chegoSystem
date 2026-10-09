import { describe, expect, it } from "vitest";
import { computeTotals, refundLedgerLines, refundShares, saleLedgerLines } from "./totals";

const base = { subtotalCents: 5000, deliveryFeeCents: 400, serviceFeeCents: 99, commissionRate: 0.1 };

describe("computeTotals", () => {
  it("without discount: delivery to the store, service fee and commission to the platform", () => {
    expect(computeTotals(base)).toEqual({
      subtotalCents: 5000,
      discountCents: 0,
      deliveryFeeCents: 400,
      serviceFeeCents: 99,
      commissionCents: 500,
      storeAmountCents: 4900,
      platformAmountCents: 599,
      totalCents: 5499,
    });
  });

  it("platform coupon: commission on the full subtotal, discount out of the platform share", () => {
    const totals = computeTotals({ ...base, productDiscountCents: 1000, discountPaidBy: "platform" });
    expect(totals.commissionCents).toBe(500);
    expect(totals.totalCents).toBe(4499);
    expect(totals.platformAmountCents).toBe(-401);
    expect(totals.storeAmountCents).toBe(4900);
  });

  it("store coupon: commission after the discount, discount out of the store share", () => {
    const totals = computeTotals({ ...base, productDiscountCents: 1000, discountPaidBy: "store" });
    expect(totals.commissionCents).toBe(400);
    expect(totals.totalCents).toBe(4499);
    expect(totals.platformAmountCents).toBe(499);
    expect(totals.storeAmountCents).toBe(4000);
  });

  it("free delivery paid by the platform: the store still receives the delivery fee", () => {
    const totals = computeTotals({ ...base, deliveryDiscountCents: 400, discountPaidBy: "platform" });
    expect(totals.discountCents).toBe(400);
    expect(totals.totalCents).toBe(5099);
    expect(totals.storeAmountCents).toBe(4900);
    expect(totals.platformAmountCents).toBe(199);
  });

  it("rounds the commission to the nearest cent and always closes the total", () => {
    const totals = computeTotals({ ...base, subtotalCents: 3335, commissionRate: 0.12 });
    expect(totals.commissionCents).toBe(400);
    expect(totals.storeAmountCents + totals.platformAmountCents).toBe(totals.totalCents);
  });

  it("never discounts more than the products or the delivery fee", () => {
    const totals = computeTotals({
      ...base,
      productDiscountCents: 99999,
      deliveryDiscountCents: 99999,
      discountPaidBy: "store",
    });
    expect(totals.discountCents).toBe(5400);
    expect(totals.totalCents).toBe(99);
  });
});

describe("ledger lines", () => {
  it("credits each side on a sale", () => {
    expect(saleLedgerLines({ storeAmountCents: 4900, platformAmountCents: 599 })).toEqual([
      { account: "store", direction: "credit", amountCents: 4900, reason: "sale" },
      { account: "platform", direction: "credit", amountCents: 599, reason: "sale" },
    ]);
  });

  it("debits the platform when its coupon is bigger than what it earns", () => {
    expect(saleLedgerLines({ storeAmountCents: 4900, platformAmountCents: -401 })[1]).toEqual({
      account: "platform", direction: "debit", amountCents: 401, reason: "sale",
    });
  });

  it("splits a refund in the same proportion as the sale", () => {
    const shares = refundShares(1000, { storeAmountCents: 4900, totalCents: 5499 });
    expect(shares).toEqual({ storeShareCents: 891, platformShareCents: 109 });
    expect(refundLedgerLines(shares)).toEqual([
      { account: "store", direction: "debit", amountCents: 891, reason: "refund" },
      { account: "platform", direction: "debit", amountCents: 109, reason: "refund" },
    ]);
  });
});
