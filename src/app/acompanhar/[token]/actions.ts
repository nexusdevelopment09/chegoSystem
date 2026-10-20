"use server";

import { revalidatePath } from "next/cache";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { guestOrderId } from "@/lib/orders/guest";
import { canTransition, type Fulfillment, type OrderStatus } from "@/lib/orders/status";
import { TransitionError, transitionOrder } from "@/lib/orders/transitions";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Visitante cancela pelo link enquanto a loja não aceitou (a mesma regra de quem tem conta). */
export async function cancelGuestOrder(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!(await rateLimit(`guest-cancel:${await clientIp()}`, 10, 600))) return;
  const orderId = await guestOrderId(token);
  if (!orderId) return;

  const at = await now();
  try {
    await sql.begin(async (tx) => {
      const [order] = await tx<{ status: OrderStatus; fulfillment: Fulfillment }[]>`select status, fulfillment from orders where id = ${orderId} for update`;
      if (!order || order.status !== "paid" || !canTransition(order.status, "cancelled", "customer", order.fulfillment)) return;
      await transitionOrder(tx, { orderId, to: "cancelled", actor: "customer", actorId: null, reason: "Cancelado pelo cliente (sem conta)", at });
    });
  } catch (error) {
    if (!(error instanceof TransitionError)) throw error;
  }
  revalidatePath(`/acompanhar/${token}`);
}
