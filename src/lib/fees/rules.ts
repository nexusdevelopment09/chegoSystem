// Regras das taxas do Chegô (cobradas da loja por pedido concluído). Funções puras.
import { toLocal } from "@/lib/time";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Dia de expediente de um instante. O expediente da noite atravessa a meia-noite: um
 * pedido concluído à 1h da manhã ainda é do dia anterior. O dia vira na hora de corte
 * (5h por padrão), no horário de Maceió.
 */
export function businessDate(at: Date, cutoffHour: number): string {
  return toLocal(new Date(at.getTime() - cutoffHour * HOUR_MS)).date;
}

/** "2026-10-09" + 3 dias -> "2026-10-12". */
export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export type FeeEntryKind =
  | "order_fee" | "order_fee_reversal" | "coupon_credit" | "coupon_credit_reversal" | "adjustment" | "carryover";

export type ClosingTotals = {
  /** Pedidos com taxa no fechamento (taxas menos estornos). */
  orderCount: number;
  /** Taxas de pedidos, já descontados os estornos. */
  feesCents: number;
  /** Créditos de cupons pagos pelo Chegô (negativo ou zero). */
  creditsCents: number;
  /** Ajustes do admin e saldo trazido de fechamentos anteriores. */
  adjustmentsCents: number;
  /** Soma de tudo: positivo, a loja deve; negativo, a loja tem crédito. */
  netCents: number;
};

/** Soma os lançamentos de um fechamento sem contar nada duas vezes. */
export function closingTotals(entries: { kind: FeeEntryKind; amountCents: number }[]): ClosingTotals {
  let feesCents = 0;
  let creditsCents = 0;
  let adjustmentsCents = 0;
  let orderCount = 0;
  for (const entry of entries) {
    if (entry.kind === "order_fee" || entry.kind === "order_fee_reversal") {
      feesCents += entry.amountCents;
      orderCount += entry.kind === "order_fee" ? 1 : -1;
    } else if (entry.kind === "coupon_credit" || entry.kind === "coupon_credit_reversal") {
      creditsCents += entry.amountCents;
    } else {
      adjustmentsCents += entry.amountCents;
    }
  }
  return { orderCount, feesCents, creditsCents, adjustmentsCents, netCents: feesCents + creditsCents + adjustmentsCents };
}
