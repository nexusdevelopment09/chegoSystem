// Como o dinheiro de um pedido é dividido entre a loja e a plataforma.
// Funções puras, em centavos. Também importado pelo seed.

export type DiscountPayer = "platform" | "store";

export type TotalsInput = {
  subtotalCents: number;
  /** Desconto nos produtos. Para cupom de frete grátis use deliveryDiscountCents. */
  productDiscountCents?: number;
  /** Parte da taxa de entrega que o cupom paga (frete grátis). */
  deliveryDiscountCents?: number;
  discountPaidBy?: DiscountPayer | null;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  /** 0.10 = 10%. A taxa da loja no momento do pedido. */
  commissionRate: number;
  /**
   * Quem faz a entrega. "store" (padrão): a loja entrega e fica com a taxa.
   * "platform": um entregador da rede do Chegô entrega, e a taxa passa pela
   * plataforma, que paga o entregador.
   */
  deliveryBy?: "store" | "platform";
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

  // Comissão: sobre o subtotal antes do desconto da plataforma e depois do desconto da loja.
  const commissionBase = input.subtotalCents - (storePays ? productDiscount : 0);
  const commissionCents = Math.round(commissionBase * input.commissionRate);

  const totalCents =
    input.subtotalCents - discountCents + input.deliveryFeeCents + input.serviceFeeCents;

  // A plataforma fica com a comissão e a taxa de serviço, e paga os próprios cupons.
  // A loja fica com todo o resto, incluindo a taxa de entrega inteira quando é ela que entrega.
  // Quando a entrega é da rede do Chegô, a taxa de entrega fica do lado da plataforma.
  const platformAmountCents =
    commissionCents + input.serviceFeeCents - (storePays ? 0 : discountCents) +
    (input.deliveryBy === "platform" ? input.deliveryFeeCents : 0);

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

/** Lançamentos de um pedido pago. Um lado cujo saldo dá zero não ganha lançamento. */
export function saleLedgerLines(split: {
  storeAmountCents: number;
  platformAmountCents: number;
}): LedgerLine[] {
  return ledgerLines(split.storeAmountCents, split.platformAmountCents, "sale", "credit");
}

/** Lançamentos que tiram um reembolso de cada lado. */
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

/** Quanto o entregador da rede ganha: a parte dele (em %) da taxa de entrega do bairro. */
export function courierFee(deliveryFeeCents: number, percent: number): number {
  return Math.round((deliveryFeeCents * Math.min(100, Math.max(0, percent))) / 100);
}

/** Divide um reembolso entre os lados na mesma proporção da venda. */
export function refundShares(
  refundCents: number,
  order: { storeAmountCents: number; totalCents: number },
): { storeShareCents: number; platformShareCents: number } {
  if (order.totalCents === 0) return { storeShareCents: 0, platformShareCents: 0 };
  const storeShareCents = Math.round((refundCents * order.storeAmountCents) / order.totalCents);
  return { storeShareCents, platformShareCents: refundCents - storeShareCents };
}
