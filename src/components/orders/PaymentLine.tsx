import { formatCents } from "@/lib/format";
import type { OrderView } from "@/lib/orders/queries";
import { STORE_PAYMENT_LABELS } from "@/lib/payments/collection";

type Payment = Pick<OrderView, "paymentMethod" | "paymentCollection" | "cashChangeForCents" | "totals">;

/** "Dinheiro na entrega · troco para R$ 50,00 (levar R$ 8,10)". O mesmo texto para cliente, loja e impressão. */
export function paymentText(order: Payment): string {
  if (order.paymentCollection === "app") {
    return `Pago pelo app (${order.paymentMethod === "pix" ? "Pix" : "cartão"})`;
  }
  const base = STORE_PAYMENT_LABELS[order.paymentMethod];
  if (order.paymentMethod !== "cash") return base;
  if (!order.cashChangeForCents) return `${base} · sem troco`;
  const change = order.cashChangeForCents - order.totals.totalCents;
  return `${base} · troco para ${formatCents(order.cashChangeForCents)} (levar ${formatCents(change)})`;
}

/**
 * Forma de pagamento do pedido. Pagando por Pix direto à loja, mostra a chave da loja
 * quando ela já aceitou (`pixKey` só vem preenchido nesse caso).
 */
export function PaymentLine({ order, pixKey = null }: { order: Payment; pixKey?: string | null }) {
  return (
    <div className="text-sm" data-testid="payment-line">
      <p><span className="text-coffee-soft">Pagamento:</span> <strong>{paymentText(order)}</strong></p>
      {order.paymentCollection === "store" && (
        <p className="text-coffee-soft">Você paga direto para a loja. O app não cobra nada.</p>
      )}
      {pixKey && (
        <p className="mt-1 rounded-2xl bg-cream px-3 py-2">
          Chave Pix da loja: <strong className="break-all" data-testid="store-pix-key">{pixKey}</strong>
        </p>
      )}
    </div>
  );
}
