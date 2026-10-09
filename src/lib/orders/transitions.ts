import "server-only";
import type postgres from "postgres";
import { adminIds, notify, storeStaffIds } from "@/lib/notifications/notify";
import { refundOrder } from "@/lib/payments/refunds";
import {
  canTransition, CUSTOMER_MESSAGES, RELEASES_STOCK,
  type Actor, type Fulfillment, type OrderStatus,
} from "./status";
import { saleLedgerLines } from "./totals";

type Tx = postgres.TransactionSql;

export class TransitionError extends Error {}

export type TransitionInput = {
  orderId: string;
  to: OrderStatus;
  actor: Actor;
  /** Who did it; null for the system (webhook, scheduled task). */
  actorId: string | null;
  reason?: string | null;
  at: Date;
  /** Admin override in exceptional cases: skips the state machine, never the log. */
  force?: boolean;
  courierId?: string | null;
};

type OrderRow = {
  id: string; code: string; status: OrderStatus; fulfillment: Fulfillment; customer_id: string; store_id: string;
  store_amount_cents: number; platform_amount_cents: number; total_cents: number; refunded_cents: number;
  coupon_id: string | null; paid_at: Date | null;
};

/**
 * The single way an order changes status. Checks the state machine, writes
 * the history, and does everything that comes with the change: ledger on
 * payment, refund on rejection or cancellation, stock and coupon given back,
 * and the notifications. Must run inside a transaction.
 */
export async function transitionOrder(tx: Tx, input: TransitionInput): Promise<OrderRow> {
  const [order] = await tx<OrderRow[]>`
    select id, code, status, fulfillment, customer_id, store_id, store_amount_cents, platform_amount_cents,
           total_cents, refunded_cents, coupon_id, paid_at
    from orders where id = ${input.orderId} for update`;
  if (!order) throw new TransitionError("Pedido não encontrado.");

  if (!input.force && !canTransition(order.status, input.to, input.actor, order.fulfillment)) {
    throw new TransitionError("Este pedido já mudou de situação. Atualize a página.");
  }
  if (input.force && !input.reason?.trim()) throw new TransitionError("Informe o motivo da alteração.");

  const { to, at } = input;
  await tx`
    update orders set
      status = ${to}::order_status,
      paid_at = case when ${to} = 'paid' then ${at} else paid_at end,
      accepted_at = case when ${to} = 'accepted' then ${at} else accepted_at end,
      ready_at = case when ${to} = 'ready' then ${at} else ready_at end,
      dispatched_at = case when ${to} = 'out_for_delivery' then ${at} else dispatched_at end,
      completed_at = case when ${to} in ('delivered', 'picked_up') then ${at} else completed_at end,
      courier_id = coalesce(${input.courierId ?? null}, courier_id)
    where id = ${order.id}`;

  await tx`
    insert into order_status_history (order_id, status, changed_by, reason, created_at)
    values (${order.id}, ${to}::order_status, ${input.actorId}, ${input.reason ?? null}, ${at})`;

  if (to === "paid") {
    for (const line of saleLedgerLines({ storeAmountCents: order.store_amount_cents, platformAmountCents: order.platform_amount_cents })) {
      await tx`
        insert into ledger_entries (account, store_id, direction, amount_cents, reason, order_id, created_at)
        values (${line.account}::ledger_account, ${line.account === "store" ? order.store_id : null},
                ${line.direction}::ledger_direction, ${line.amountCents}, ${line.reason}, ${order.id}, ${at})`;
    }
    await notify({
      profileIds: await storeStaffIds(order.store_id, tx), type: "order_new", title: "Novo pedido!",
      body: `Pedido ${order.code} chegou. Aceite em poucos minutos.`, link: "/lojista/pedidos",
      orderId: order.id, channels: ["push"], at,
    }, tx);
  }

  // Money goes back in full whenever a paid order is refused or cancelled.
  const paid = order.paid_at !== null || order.status !== "awaiting_payment";
  if ((to === "rejected" || to === "cancelled") && paid && order.refunded_cents < order.total_cents) {
    await refundOrder(tx, {
      orderId: order.id, amountCents: "all", at, requestedBy: input.actorId,
      reason: to === "rejected" ? `Pedido recusado: ${input.reason ?? "sem motivo"}` : `Pedido cancelado: ${input.reason ?? "sem motivo"}`,
    });
  }

  if (RELEASES_STOCK.includes(to)) await releaseReservations(tx, order);

  const message = CUSTOMER_MESSAGES[to];
  if (message) {
    await notify({
      profileIds: [order.customer_id], type: `order_${to}`, title: message.title, body: message.body,
      link: `/pedidos/${order.id}`, orderId: order.id, at,
      channels: to === "rejected" || to === "cancelled" ? ["push", "sms"] : ["push"],
    }, tx);
  }
  if (to === "rejected" && input.actor === "system") {
    await notify({
      profileIds: await adminIds(tx), type: "order_auto_rejected", title: "Pedido recusado por falta de aceite",
      body: `O pedido ${order.code} ficou sem resposta da loja e foi recusado com reembolso.`,
      link: `/admin/pedidos/${order.id}`, orderId: order.id, at,
    }, tx);
  }

  return { ...order, status: to };
}

/** Puts the stock back and frees the coupon of an order that will not happen. */
async function releaseReservations(tx: Tx, order: OrderRow) {
  await tx`
    update products p set stock_qty = p.stock_qty + i.quantity
    from (
      select product_id, sum(quantity)::int as quantity
      from order_items where order_id = ${order.id} and product_id is not null and removed_at is null
      group by product_id
    ) i
    where p.id = i.product_id and p.track_stock`;

  if (order.coupon_id) {
    const freed = await tx`delete from coupon_redemptions where order_id = ${order.id} returning id`;
    if (freed.length > 0) {
      await tx`update coupons set uses_count = greatest(uses_count - 1, 0) where id = ${order.coupon_id}`;
    }
  }
}
