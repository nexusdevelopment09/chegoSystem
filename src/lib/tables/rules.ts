// Contas de mesa e balcão. Funções puras.

export type BillItem = { unitPriceCents: number; quantity: number; cancelled: boolean };
export type BillPayment = { method: "pix" | "card" | "cash"; amountCents: number; cancelled: boolean };

export type BillTotals = {
  totalCents: number;
  paidCents: number;
  /** Quanto ainda falta pagar (nunca negativo). */
  remainingCents: number;
  /** Troco: pago a mais em dinheiro. */
  changeCents: number;
};

export function billTotals(items: BillItem[], payments: BillPayment[]): BillTotals {
  const totalCents = items.filter((item) => !item.cancelled).reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const valid = payments.filter((payment) => !payment.cancelled);
  const paidCents = valid.reduce((sum, payment) => sum + payment.amountCents, 0);
  const cashCents = valid.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amountCents, 0);
  const over = Math.max(0, paidCents - totalCents);
  return { totalCents, paidCents, remainingCents: Math.max(0, totalCents - paidCents), changeCents: Math.min(over, cashCents) };
}

/**
 * Pagamento novo: maior que zero; Pix e cartão no máximo o que falta (cartão não dá troco);
 * dinheiro pode passar do que falta (vira troco).
 */
export function paymentProblem(totals: BillTotals, method: BillPayment["method"], amountCents: number): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Diga o valor recebido.";
  if (totals.remainingCents === 0) return "A conta já está paga.";
  if (method !== "cash" && amountCents > totals.remainingCents) return "Pix e cartão: no máximo o valor que falta. Para troco, use dinheiro.";
  return null;
}

/** Pode fechar? Precisa ter item e estar paga (o que passou só pode ser troco em dinheiro). */
export function closeProblem(totals: BillTotals): string | null {
  if (totals.totalCents === 0) return "A conta não tem itens.";
  if (totals.remainingCents > 0) return `Ainda falta receber ${(totals.remainingCents / 100).toFixed(2).replace(".", ",")}.`;
  if (totals.paidCents - totals.totalCents > totals.changeCents) return "Pago a mais em Pix ou cartão: cancele o pagamento errado.";
  return null;
}

/** A forma de pagamento que vai no pedido: a de maior valor recebido. */
export function mainMethod(payments: BillPayment[]): BillPayment["method"] {
  const totals = new Map<BillPayment["method"], number>();
  for (const payment of payments.filter((item) => !item.cancelled)) totals.set(payment.method, (totals.get(payment.method) ?? 0) + payment.amountCents);
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "cash";
}
