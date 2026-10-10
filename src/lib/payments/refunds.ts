import "server-only";
import type postgres from "postgres";
import { refundLedgerLines, refundShares } from "@/lib/orders/totals";
import { getPaymentProvider } from "./index";

type Tx = postgres.TransactionSql;

export class RefundError extends Error {}

/**
 * Devolve dinheiro ao cliente por um pedido: pede ao gateway, grava
 * o reembolso e escreve o estorno nos lançamentos, tirando da loja
 * e da plataforma na mesma proporção da venda.
 * Tem que rodar dentro da transação que muda o pedido.
 */
export async function refundOrder(
  tx: Tx,
  input: { orderId: string; amountCents: number | "all"; reason: string; requestedBy: string | null; at: Date },
): Promise<{ refundedCents: number; fully: boolean }> {
  const [order] = await tx<{
    id: string; store_id: string; total_cents: number; refunded_cents: number; store_amount_cents: number;
  }[]>`
    select id, store_id, total_cents, refunded_cents, store_amount_cents
    from orders where id = ${input.orderId} for update`;
  if (!order) throw new RefundError("Pedido não encontrado.");

  const [payment] = await tx<{ id: string; provider_payment_id: string }[]>`
    select id, provider_payment_id from payments
    where order_id = ${order.id} and status in ('approved', 'partially_refunded')
    order by created_at desc limit 1`;
  if (!payment) throw new RefundError("Este pedido não tem pagamento aprovado para reembolsar.");

  const remaining = order.total_cents - order.refunded_cents;
  const amount = input.amountCents === "all" ? remaining : input.amountCents;
  if (!Number.isInteger(amount) || amount <= 0) throw new RefundError("Valor de reembolso inválido.");
  if (amount > remaining) throw new RefundError("O reembolso é maior do que o valor que ainda pode ser devolvido.");

  const { providerRefundId } = await getPaymentProvider().refund({
    providerPaymentId: payment.provider_payment_id, amountCents: amount, reason: input.reason,
  });

  // No último reembolso a loja devolve exatamente o que sobrou da parte dela.
  const fully = amount === remaining;
  const [{ already_from_store }] = await tx<{ already_from_store: number }[]>`
    select coalesce(sum(store_share_cents), 0)::int as already_from_store from refunds where order_id = ${order.id}`;
  const shares = fully
    ? { storeShareCents: order.store_amount_cents - already_from_store, platformShareCents: amount - (order.store_amount_cents - already_from_store) }
    : refundShares(amount, { storeAmountCents: order.store_amount_cents, totalCents: order.total_cents });

  const [refund] = await tx<{ id: string }[]>`
    insert into refunds (order_id, payment_id, amount_cents, store_share_cents, platform_share_cents, reason, requested_by, provider_refund_id, created_at)
    values (${order.id}, ${payment.id}, ${amount}, ${shares.storeShareCents}, ${shares.platformShareCents},
            ${input.reason}, ${input.requestedBy}, ${providerRefundId}, ${input.at})
    returning id`;

  for (const line of refundLedgerLines(shares)) {
    await tx`
      insert into ledger_entries (account, store_id, direction, amount_cents, reason, order_id, refund_id, created_at)
      values (${line.account}::ledger_account, ${line.account === "store" ? order.store_id : null},
              ${line.direction}::ledger_direction, ${line.amountCents}, ${line.reason}, ${order.id}, ${refund.id}, ${input.at})`;
  }

  await tx`update orders set refunded_cents = refunded_cents + ${amount} where id = ${order.id}`;
  await tx`update payments set status = ${fully ? "refunded" : "partially_refunded"}::payment_status where id = ${payment.id}`;

  return { refundedCents: amount, fully };
}
