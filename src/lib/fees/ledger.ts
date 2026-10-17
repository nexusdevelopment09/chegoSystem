import "server-only";
import type postgres from "postgres";
import { getSettings } from "@/lib/settings";
import { businessDate } from "./rules";

type Tx = postgres.TransactionSql;

/**
 * Lança na conta da loja com o Chegô o que um pedido concluído gera: a taxa por pedido
 * e, se o pedido usou um cupom pago pelo Chegô, o crédito desse desconto (o cliente
 * pagou menos à loja; o Chegô devolve à loja abatendo das taxas).
 *
 * Só para pedidos pagos direto à loja. O índice único (pedido, tipo) garante que
 * reprocessar, repetir uma chamada ou duas transações ao mesmo tempo nunca duplicam.
 */
export async function recordCompletedOrderFees(
  tx: Tx,
  order: { id: string; store_id: string; discount_cents: number; discount_paid_by: "platform" | "store" | null },
  at: Date,
) {
  const settings = await getSettings();
  const day = businessDate(at, settings.business_day_cutoff_hour);
  await tx`
    insert into fee_entries (store_id, order_id, kind, amount_cents, business_date, created_at)
    values (${order.store_id}, ${order.id}, 'order_fee', ${settings.order_fee_cents}, ${day}, ${at})
    on conflict (order_id, kind) where order_id is not null do nothing`;

  if (order.discount_cents > 0 && order.discount_paid_by === "platform") {
    await tx`
      insert into fee_entries (store_id, order_id, kind, amount_cents, business_date, created_at)
      values (${order.store_id}, ${order.id}, 'coupon_credit', ${-order.discount_cents}, ${day}, ${at})
      on conflict (order_id, kind) where order_id is not null do nothing`;
  }
}

/**
 * Pedido reembolsado depois de concluído: a taxa e o crédito do cupom são estornados por
 * lançamentos novos, ligados aos originais. Nada é apagado. Também nunca duplica.
 */
export async function reverseOrderFees(tx: Tx, orderId: string, at: Date, reason: string) {
  const settings = await getSettings();
  const day = businessDate(at, settings.business_day_cutoff_hour);
  const originals = await tx<{ id: string; store_id: string; kind: "order_fee" | "coupon_credit"; amount_cents: number }[]>`
    select id, store_id, kind, amount_cents from fee_entries
    where order_id = ${orderId} and kind in ('order_fee', 'coupon_credit')`;
  for (const original of originals) {
    await tx`
      insert into fee_entries (store_id, order_id, kind, amount_cents, business_date, reverses_id, reason, created_at)
      values (${original.store_id}, ${orderId}, ${original.kind === "order_fee" ? "order_fee_reversal" : "coupon_credit_reversal"}::fee_entry_kind,
              ${-original.amount_cents}, ${day}, ${original.id}, ${reason}, ${at})
      on conflict (order_id, kind) where order_id is not null do nothing`;
  }
}
