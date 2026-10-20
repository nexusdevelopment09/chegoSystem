"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { createOrderPayment } from "@/lib/checkout/place-order";
import { TransitionError, transitionOrder } from "@/lib/orders/transitions";
import { isMockPayments } from "@/lib/payments";
import { paymentCollection } from "@/lib/payments/collection";
import { buildMockWebhook, mockCardOutcome } from "@/lib/payments/mock";
import { handlePaymentWebhook } from "@/lib/payments/webhook";
import { rateLimit } from "@/lib/rate-limit";

export type ActionResult = { ok: true } | { ok: false; error: string };

const SIMULATED_EVENTS = { approve: "payment.approved", decline: "payment.declined", expire: "payment.expired" } as const;

/**
 * Pagamento simulado: o próprio cliente faz o papel do banco, só no pedido dele e só
 * enquanto o pagamento for simulado. O aviso passa pelo mesmo webhook assinado de um
 * gateway de verdade. Recusa e expiração são só para os testes deste computador.
 */
export async function simulateMyPayment(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || !isMockPayments() || paymentCollection() !== "app") return;
  const orderId = z.uuid().parse(formData.get("orderId"));
  const outcome = z.enum(isLocalEnv ? ["approve", "decline", "expire"] : ["approve"]).parse(formData.get("outcome"));
  if (!(await rateLimit(`simulate-payment:${profile.id}`, 20, 600))) return;

  const [payment] = await sql<{ provider_payment_id: string }[]>`
    select p.provider_payment_id from payments p join orders o on o.id = p.order_id
    where p.order_id = ${orderId} and o.customer_id = ${profile.id} and p.status in ('pending', 'declined')
    order by p.created_at desc limit 1`;
  if (payment) {
    const { rawBody, signature } = buildMockWebhook(payment.provider_payment_id, SIMULATED_EVENTS[outcome]);
    await handlePaymentWebhook(rawBody, signature);
  }

  const [order] = await sql<{ status: string }[]>`select status from orders where id = ${orderId} and customer_id = ${profile.id}`;
  if (order && order.status !== "awaiting_payment") redirect(`/pedidos/${orderId}`);
  revalidatePath(`/pedidos/${orderId}/pagamento`);
}

/** O cliente desiste de um pedido que a loja ainda não aceitou. Pedidos pagos são reembolsados por inteiro. */
export async function cancelOrder(formData: FormData): Promise<void> {
  const orderId = z.uuid().parse(formData.get("orderId"));
  const profile = await getCurrentProfile();
  if (!profile) return;

  const at = await now();
  try {
    await sql.begin(async (tx) => {
      const [order] = await tx`select id from orders where id = ${orderId} and customer_id = ${profile.id} for update`;
      if (!order) throw new TransitionError("Pedido não encontrado.");
      await transitionOrder(tx, { orderId, to: "cancelled", actor: "customer", actorId: profile.id, reason: "Cancelado pelo cliente", at });
    });
  } catch (error) {
    if (!(error instanceof TransitionError)) throw error;
    // A loja aceitou nesse meio-tempo: a página recarrega e mostra isso.
  }
  revalidatePath(`/pedidos/${orderId}`);
}

const cardSchema = z.object({
  number: z.string().regex(/^[\d ]{13,23}$/),
  holder: z.string().trim().min(3).max(60),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/),
  cvv: z.string().regex(/^\d{3,4}$/),
});

/** Troca um pedido não pago para cartão (ou tenta outro cartão depois de uma recusa). */
export async function payWithCard(formData: FormData): Promise<void> {
  const orderId = z.uuid().parse(formData.get("orderId"));
  const card = cardSchema.safeParse({
    number: formData.get("number"), holder: formData.get("holder"), expiry: formData.get("expiry"), cvv: formData.get("cvv"),
  });
  const profile = await getCurrentProfile();
  if (!profile || !card.success || paymentCollection() !== "app") return;
  if (!(await rateLimit(`checkout:${profile.id}`, 10, 600))) return;

  const at = await now();
  const created = await sql.begin(async (tx) => {
    const [order] = await tx<{ id: string; code: string; store_id: string; total_cents: number; store_amount_cents: number; platform_amount_cents: number; payment_expires_at: Date }[]>`
      select id, code, store_id, total_cents, store_amount_cents, platform_amount_cents, payment_expires_at
      from orders where id = ${orderId} and customer_id = ${profile.id} and status = 'awaiting_payment' for update`;
    if (!order) return null;

    // A tentativa anterior (Pix não pago ou cartão recusado) é encerrada.
    await tx`update payments set status = 'expired' where order_id = ${order.id} and status = 'pending'`;
    await tx`update orders set payment_method = 'card' where id = ${order.id}`;
    return createOrderPayment(tx, {
      orderId: order.id, code: order.code, storeId: order.store_id, method: "card", expiresAt: order.payment_expires_at, at,
      card: card.data, totalCents: order.total_cents, storeAmountCents: order.store_amount_cents, platformAmountCents: order.platform_amount_cents,
    });
  });

  if (created) {
    const type = mockCardOutcome(card.data.number) === "approved" ? "payment.approved" : "payment.declined";
    const { rawBody, signature } = buildMockWebhook(created.providerPaymentId, type);
    await handlePaymentWebhook(rawBody, signature);
  }
  const [order] = await sql<{ status: string }[]>`select status from orders where id = ${orderId}`;
  if (order?.status !== "awaiting_payment") redirect(`/pedidos/${orderId}`);
  revalidatePath(`/pedidos/${orderId}/pagamento`);
}
