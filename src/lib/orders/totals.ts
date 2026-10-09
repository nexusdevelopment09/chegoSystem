// How an order's money is split between the store and the platform.
// Pure functions, in cents. Also imported by the seed.

export type DiscountPayer = "platform" | "store";

export type TotalsInput = {
  subtotalCents: number;
  /** Discount on the products. For a free-delivery coupon use deliveryDiscountCents. */
  productDiscountCents?: number;
  /** Part of the delivery fee the coupon pays (free delivery). */
  deliveryDiscountCents?: number;
  discountPaidBy?: DiscountPayer | null;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  /** 0.10 = 10%. The store's rate at the moment of the order. */
  commissionRate: number;
};

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  commissionCents: number;
  storeAmountCents: number;
  platformAmountCents: number;
  totalCents: number;
};

export function computeTotals(input: TotalsInput): Totals {
  const productDiscount = Math.min(input.productDiscountCents ?? 0, input.subtotalCents);
  const deliveryDiscount = Math.min(input.deliveryDiscountCents ?? 0, input.deliveryFeeCents);
  const discountCents = productDiscount + deliveryDiscount;
  const storePays = discountCents > 0 && input.discountPaidBy === "store";

  // Commission: on the subtotal before a platform discount, after a store discount.
  const commissionBase = input.subtotalCents - (storePays ? productDiscount : 0);
  const commissionCents = Math.round(commissionBase * input.commissionRate);

  const totalCents =
    input.subtotalCents - discountCents + input.deliveryFeeCents + input.serviceFeeCents;

  // The platform keeps commission and service fee, and pays its own coupons.
  // The store gets everything else, including the whole delivery fee.
  const platformAmountCents =
    commissionCents + input.serviceFeeCents - (storePays ? 0 : discountCents);

  return {
    subtotalCents: input.subtotalCents,
    discountCents,
    deliveryFeeCents: input.deliveryFeeCents,
    serviceFeeCents: input.serviceFeeCents,
    commissionCents,
    storeAmountCents: totalCents - platformAmountCents,
    platformAmountCents,
    totalCents,
  };
}

export type LedgerLine = {
  account: "store" | "platform";
  direction: "credit" | "debit";
  amountCents: number;
  reason: string;
};

/** Ledger lines for a paid order. A side that nets to zero gets no line. */
export function saleLedgerLines(split: {
  storeAmountCents: number;
  platformAmountCents: number;
}): LedgerLine[] {
  return ledgerLines(split.storeAmountCents, split.platformAmountCents, "sale", "credit");
}

/** Ledger lines taking a refund back from each side. */
export function refundLedgerLines(shares: {
  storeShareCents: number;
  platformShareCents: number;
}): LedgerLine[] {
  return ledgerLines(shares.storeShareCents, shares.platformShareCents, "refund", "debit");
}

function ledgerLines(
  storeCents: number,
  platformCents: number,
  reason: string,
  positive: "credit" | "debit",
): LedgerLine[] {
  const negative = positive === "credit" ? "debit" : "credit";
  const line = (account: "store" | "platform", cents: number): LedgerLine[] =>
    cents === 0
      ? []
      : [{ account, direction: cents > 0 ? positive : negative, amountCents: Math.abs(cents), reason }];
  return [...line("store", storeCents), ...line("platform", platformCents)];
}

/** Splits a refund between the sides in the same proportion as the sale. */
export function refundShares(
  refundCents: number,
  order: { storeAmountCents: number; totalCents: number },
): { storeShareCents: number; platformShareCents: number } {
  if (order.totalCents === 0) return { storeShareCents: 0, platformShareCents: 0 };
  const storeShareCents = Math.round((refundCents * order.storeAmountCents) / order.totalCents);
  return { storeShareCents, platformShareCents: refundCents - storeShareCents };
}
