import type { Totals } from "@/lib/orders/totals";
import { formatCents } from "@/lib/format";

/** Subtotal, desconto, entrega, taxa de serviço e total. Usado na sacola, no checkout e nas páginas de pedido. */
export function OrderSummary({ totals, fulfillment }: { totals: Totals; fulfillment: "delivery" | "pickup" }) {
  const row = "flex justify-between gap-3 py-1";
  return (
    <dl className="text-base" data-testid="order-summary">
      <div className={row}>
        <dt>Subtotal</dt>
        <dd data-testid="summary-subtotal">{formatCents(totals.subtotalCents)}</dd>
      </div>
      {totals.discountCents > 0 && (
        <div className={`${row} font-semibold text-success`}>
          <dt>Desconto</dt>
          <dd data-testid="summary-discount">− {formatCents(totals.discountCents)}</dd>
        </div>
      )}
      <div className={row}>
        <dt>{fulfillment === "delivery" ? "Entrega" : "Retirada no balcão"}</dt>
        <dd data-testid="summary-delivery">{totals.deliveryFeeCents === 0 ? "Grátis" : formatCents(totals.deliveryFeeCents)}</dd>
      </div>
      {totals.serviceFeeCents > 0 && (
        <div className={row}>
          <dt>Taxa de serviço</dt>
          <dd>{formatCents(totals.serviceFeeCents)}</dd>
        </div>
      )}
      <div className={`${row} mt-1 border-t border-peach pt-2 text-xl font-bold`}>
        <dt>Total</dt>
        <dd data-testid="summary-total">{formatCents(totals.totalCents)}</dd>
      </div>
    </dl>
  );
}
