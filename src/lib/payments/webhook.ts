import "server-only";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { transitionOrder } from "@/lib/orders/transitions";
import { getPaymentProvider } from "./index";
import { refundOrder } from "./refunds";

export type WebhookOutcome = "processed" | "duplicate" | "invalid_signature" | "unknown_payment";

/**
 * Handles a payment event from the gateway. This is the only way an order
 * becomes "paid".
 *
 * - The signature is checked first; a wrong one changes nothing.
 * - Each event id is stored once. The same event arriving again (gateways
 *   retry) finds the row already there and stops: nothing is duplicated.
 */
export async function handlePaymentWebhook(rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const provider = getPaymentProvider();
  const event = provider.parseWebhook(rawBody, signature);
  if (!event) return "invalid_signature";

  const at = await now();

  return sql.begin(async (tx): Promise<WebhookOutcome> => {
    const inserted = await tx`
      insert into webhook_events (provider, event_id, payload)
      values (${provider.name}, ${event.eventId}, ${tx.json(event.raw as never)})
      on conflict (provider, event_id) do nothing
      returning id`;
    if (inserted.length === 0) return "duplicate";

    const [payment] = await tx<{ id: string; order_id: string | null; invoice_id: string | null; status: string; amount_cents: number }[]>`
      select id, order_id, invoice_id, status, amount_cents
      from payments
      where provider = ${provider.name} and provider_payment_id = ${event.providerPaymentId}
      for update`;
    if (!payment) return "unknown_payment";

    // A payment that already reached a final answer ignores later events.
    // (A declined payment can still be approved on a retry, or expire.)
    const open = payment.status === "pending" || (payment.status === "declined" && event.type !== "payment.declined");

    if (open && event.type === "payment.approved") {
      await tx`update payments set status = 'approved' where id = ${payment.id}`;

      if (payment.order_id) {
        const [order] = await tx<{ status: string }[]>`select status from orders where id = ${payment.order_id} for update`;
        if (order.status === "awaiting_payment") {
          await transitionOrder(tx, { orderId: payment.order_id, to: "paid", actor: "system", actorId: null, at });
        } else {
          // Paid after the order expired or was cancelled: the money goes straight back.
          await refundOrder(tx, { orderId: payment.order_id, amountCents: "all", reason: "Pagamento recebido depois do prazo", requestedBy: null, at });
        }
      } else if (payment.invoice_id) {
        await tx`update invoices set status = 'paid', paid_at = ${at} where id = ${payment.invoice_id} and status <> 'paid'`;
        await tx`
          insert into ledger_entries (account, direction, amount_cents, reason, invoice_id, created_at)
          values ('platform', 'credit', ${payment.amount_cents}, 'subscription', ${payment.invoice_id}, ${at})`;
      }
    } else if (open && event.type === "payment.declined") {
      await tx`update payments set status = 'declined' where id = ${payment.id}`;
    } else if (open && event.type === "payment.expired") {
      await tx`update payments set status = 'expired' where id = ${payment.id}`;
      if (payment.order_id) {
        const [order] = await tx<{ status: string }[]>`select status from orders where id = ${payment.order_id} for update`;
        if (order.status === "awaiting_payment") {
          await transitionOrder(tx, {
            orderId: payment.order_id, to: "expired", actor: "system", actorId: null, at, reason: "Pagamento não feito no prazo",
          });
        }
      }
    }

    await tx`update webhook_events set processed_at = ${at} where id = ${inserted[0].id}`;
    return "processed";
  }) as Promise<WebhookOutcome>;
}
