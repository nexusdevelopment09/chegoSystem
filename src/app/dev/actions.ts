"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { now, setSimulatedNow } from "@/lib/clock";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { saleLedgerLines } from "@/lib/orders/totals";

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
  redirect(profile.role === "admin" ? "/admin" : "/");
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

/**
 * Plays the part of the payment gateway for an order waiting for payment.
 * Etapa 7 replaces the inside of this with the real webhook flow of the
 * MockPaymentProvider; the buttons stay the same.
 */
export async function simulatePayment(formData: FormData) {
  assertLocal();
  const orderId = uuid.parse(formData.get("orderId"));
  const outcome = z.enum(["approve", "decline", "expire"]).parse(formData.get("outcome"));
  const at = await now();

  await sql.begin(async (tx) => {
    const [order] = await tx<{ id: string; store_id: string; store_amount_cents: number; platform_amount_cents: number }[]>`
      select id, store_id, store_amount_cents, platform_amount_cents
      from orders
      where id = ${orderId} and status = 'awaiting_payment'
      for update`;
    if (!order) return; // Already handled: clicking twice changes nothing.

    if (outcome === "decline") {
      await tx`update payments set status = 'declined' where order_id = ${orderId} and status = 'pending'`;
      return;
    }

    if (outcome === "expire") {
      await tx`update payments set status = 'expired' where order_id = ${orderId} and status in ('pending', 'declined')`;
      await tx`update orders set status = 'expired' where id = ${orderId}`;
      await tx`
        insert into order_status_history (order_id, status, reason, created_at)
        values (${orderId}, 'expired', 'Pix não pago no prazo', ${at})`;
      return;
    }

    await tx`update payments set status = 'approved' where order_id = ${orderId} and status in ('pending', 'declined')`;
    await tx`update orders set status = 'paid', paid_at = ${at} where id = ${orderId}`;
    await tx`
      insert into order_status_history (order_id, status, created_at)
      values (${orderId}, 'paid', ${at})`;

    for (const line of saleLedgerLines({
      storeAmountCents: order.store_amount_cents,
      platformAmountCents: order.platform_amount_cents,
    })) {
      await tx`
        insert into ledger_entries (account, store_id, direction, amount_cents, reason, order_id, created_at)
        values (
          ${line.account}::ledger_account, ${line.account === "store" ? order.store_id : null},
          ${line.direction}::ledger_direction, ${line.amountCents}, ${line.reason}, ${orderId}, ${at}
        )`;
    }

    await tx`
      insert into notifications (profile_id, type, title, body, link, order_id, created_at)
      select profile_id, 'order_new', 'Novo pedido!', 'Chegou um pedido novo. Aceite em até 8 minutos.',
             '/lojista/pedidos', ${orderId}, ${at}
      from store_members
      where store_id = ${order.store_id} and role in ('owner', 'attendant')`;
  });

  revalidatePath("/dev");
}
