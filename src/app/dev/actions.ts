"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { setSimulatedNow } from "@/lib/clock";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { buildMockWebhook } from "@/lib/payments/mock";
import { handlePaymentWebhook } from "@/lib/payments/webhook";

// Every action here is a shortcut for testing and refuses to run anywhere
// but the test environment.
function assertLocal() {
  if (!isLocalEnv) throw new Error("Not available outside the test environment.");
}

const uuid = z.uuid();

export async function loginAs(formData: FormData) {
  assertLocal();
  const profileId = uuid.parse(formData.get("profileId"));

  const [profile] = await sql<{ id: string; role: string }[]>`
    select id, role from profiles where id = ${profileId} and deleted_at is null`;
  if (!profile) throw new Error("Test user not found.");

  await createSession(profile.id);
  redirect(profile.role === "admin" ? "/admin" : profile.role === "merchant" ? "/lojista" : "/");
}

export async function setClock(formData: FormData) {
  assertLocal();
  // The field is a local date and time in Maceió, which is UTC-3 all year.
  const value = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).parse(formData.get("datetime"));
  await setSimulatedNow(new Date(`${value}:00-03:00`));
  revalidatePath("/dev");
}

export async function resetClock() {
  assertLocal();
  await setSimulatedNow(null);
  revalidatePath("/dev");
}

const EVENT_TYPES = {
  approve: "payment.approved",
  decline: "payment.declined",
  expire: "payment.expired",
} as const;

/**
 * Plays the part of the bank: the pretend gateway sends a signed webhook for
 * the order's payment, exactly the path a real gateway will use.
 */
export async function simulatePayment(formData: FormData) {
  assertLocal();
  const orderId = uuid.parse(formData.get("orderId"));
  const outcome = z.enum(["approve", "decline", "expire"]).parse(formData.get("outcome"));
  const back = z.string().startsWith("/").max(200).optional().parse(formData.get("back") ?? undefined);

  const [payment] = await sql<{ provider_payment_id: string }[]>`
    select provider_payment_id from payments
    where order_id = ${orderId} and status in ('pending', 'declined')
    order by created_at desc limit 1`;

  if (payment) {
    const { rawBody, signature } = buildMockWebhook(payment.provider_payment_id, EVENT_TYPES[outcome]);
    await handlePaymentWebhook(rawBody, signature);
  }

  revalidatePath("/dev");
  if (!back) return;
  // Going "back" to the payment page of an order that is no longer waiting
  // would show stale content: go straight to the tracking page.
  const [order] = await sql<{ status: string }[]>`select status from orders where id = ${orderId}`;
  if (order?.status !== "awaiting_payment") redirect(`/pedidos/${orderId}`);
  revalidatePath(back);
}
