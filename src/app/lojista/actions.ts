"use server";

import { revalidatePath } from "next/cache";
import type postgres from "postgres";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireStoreMember, type StoreRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { notify } from "@/lib/notifications/notify";
import { REJECT_REASONS, type OrderStatus } from "@/lib/orders/status";
import { TransitionError, transitionOrder } from "@/lib/orders/transitions";
import { RefundError, refundOrder } from "@/lib/payments/refunds";
import { MINUTE_MS } from "@/lib/time";

type Tx = postgres.TransactionSql;
export type ActionState = { error?: string; ok?: boolean };

const uuid = z.uuid();
const friendly = (error: unknown): ActionState => {
  if (error instanceof TransitionError || error instanceof RefundError) return { error: error.message };
  throw error;
};

/**
 * Runs a change on one of the store's orders. The order must belong to the
 * store the user works for (and be already paid: the store never touches an
 * order before the payment is confirmed).
 */
async function onStoreOrder(
  orderId: unknown,
  roles: StoreRole[],
  run: (tx: Tx, context: { orderId: string; storeId: string; profileId: string; role: StoreRole; at: Date }) => Promise<void>,
): Promise<ActionState> {
  const parsedId = uuid.safeParse(orderId);
  if (!parsedId.success) return { error: "Pedido inválido." };

  const { profile, membership } = await requireStoreMember(roles);
  const at = await now();
  try {
    await sql.begin(async (tx) => {
      const [order] = await tx`
        select id from orders
        where id = ${parsedId.data} and store_id = ${membership.storeId} and paid_at is not null
        for update`;
      if (!order) throw new TransitionError("Pedido não encontrado.");
      await run(tx, { orderId: parsedId.data, storeId: membership.storeId, profileId: profile.id, role: membership.role, at });
    });
  } catch (error) {
    return friendly(error);
  }
  revalidatePath("/lojista", "layout");
  return { ok: true };
}

export async function acceptOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const prepMinutes = z.coerce.number().int().min(1).max(600).safeParse(formData.get("prepMinutes"));
  if (!prepMinutes.success) return { error: "Tempo de preparo inválido." };

  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], async (tx, context) => {
    await transitionOrder(tx, { orderId: context.orderId, to: "accepted", actor: "staff", actorId: context.profileId, at: context.at });
    // The estimate shown to the customer follows the time the store promised.
    await tx`
      update orders o set estimated_at = coalesce(o.scheduled_for,
        ${context.at}::timestamptz + make_interval(mins => ${prepMinutes.data} + coalesce((
          select a.max_minutes from store_delivery_areas a
          where a.store_id = o.store_id and a.neighborhood_id = o.neighborhood_id), 0)))
      where o.id = ${context.orderId}`;
  });
}

export async function rejectOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const reason = z.enum(REJECT_REASONS).safeParse(formData.get("reason"));
  if (!reason.success) return { error: "Escolha o motivo da recusa." };
  const detail = z.string().trim().max(200).parse(formData.get("detail") ?? "");
  if (reason.data === "Outro" && !detail) return { error: "Conte o motivo em poucas palavras." };

  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], (tx, context) =>
    transitionOrder(tx, {
      orderId: context.orderId, to: "rejected", actor: "staff", actorId: context.profileId, at: context.at,
      reason: reason.data === "Outro" ? detail : reason.data,
    }).then(() => undefined));
}

const ADVANCE: OrderStatus[] = ["preparing", "ready", "out_for_delivery", "picked_up"];

/** Moves the order one step forward: preparing, ready, out for delivery or picked up. */
export async function advanceOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const to = z.enum(ADVANCE as [OrderStatus, ...OrderStatus[]]).safeParse(formData.get("to"));
  if (!to.success) return { error: "Mudança inválida." };
  const courierId = uuid.safeParse(formData.get("courierId"));

  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], async (tx, context) => {
    let courier: string | null = null;
    if (to.data === "out_for_delivery" && courierId.success) {
      const [member] = await tx`
        select profile_id from store_members where store_id = ${context.storeId} and profile_id = ${courierId.data}`;
      if (!member) throw new TransitionError("Esse entregador não é da sua loja.");
      courier = courierId.data;
    }
    await transitionOrder(tx, {
      orderId: context.orderId, to: to.data, actor: "staff", actorId: context.profileId, at: context.at, courierId: courier,
    });
    if (courier) {
      await notify({
        profileIds: [courier], type: "delivery_assigned", title: "Nova entrega para você",
        body: "Um pedido saiu para entrega com você.", link: "/lojista/entregas", orderId: context.orderId, channels: ["push"], at: context.at,
      }, tx);
    }
  });
}

/**
 * Marks the order as delivered. The courier types the 4-digit code the
 * customer shows. Without the code, only the owner can do it, with a reason.
 */
export async function deliverOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const code = z.string().trim().max(4).parse(formData.get("code") ?? "");
  const reason = z.string().trim().max(200).parse(formData.get("reason") ?? "");

  return onStoreOrder(formData.get("orderId"), ["owner", "attendant", "courier"], async (tx, context) => {
    const [order] = await tx<{ delivery_code: string | null; courier_id: string | null }[]>`
      select delivery_code, courier_id from orders where id = ${context.orderId}`;

    if (context.role === "courier" && order.courier_id !== context.profileId) {
      throw new TransitionError("Essa entrega não é sua.");
    }
    const codeMatches = code !== "" && code === order.delivery_code;
    if (!codeMatches) {
      if (code) throw new TransitionError("Código errado. Peça ao cliente o código de 4 números que aparece no pedido.");
      if (context.role !== "owner") throw new TransitionError("Digite o código de entrega que o cliente recebeu.");
      if (!reason) throw new TransitionError("Sem o código, diga por que o pedido está sendo marcado como entregue.");
      await audit({
        actorId: context.profileId, action: "order.delivered_without_code", entityType: "order",
        entityId: context.orderId, storeId: context.storeId, details: { reason },
      }, tx);
    }

    await transitionOrder(tx, {
      orderId: context.orderId, to: "delivered", actor: context.role === "courier" ? "courier" : "staff",
      actorId: context.profileId, at: context.at, reason: codeMatches ? null : `Sem código: ${reason}`,
    });
  });
}

/** The store ran out of an item: it is taken off the order and its value goes back to the customer. */
export async function removeMissingItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = uuid.safeParse(formData.get("itemId"));
  if (!itemId.success) return { error: "Item inválido." };

  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], async (tx, context) => {
    const [order] = await tx<{ status: OrderStatus; customer_id: string; code: string; total_cents: number; refunded_cents: number }[]>`
      select status, customer_id, code, total_cents, refunded_cents from orders where id = ${context.orderId}`;
    if (!["accepted", "preparing"].includes(order.status)) {
      throw new TransitionError("Só dá para remover item enquanto o pedido está aceito ou em preparo.");
    }
    const active = await tx<{ id: string; name: string; line_total_cents: number }[]>`
      select id, name, line_total_cents from order_items where order_id = ${context.orderId} and removed_at is null`;
    const item = active.find((row) => row.id === itemId.data);
    if (!item) throw new TransitionError("Esse item já foi removido.");
    if (active.length === 1) throw new TransitionError("É o único item do pedido. Nesse caso, fale com o suporte para cancelar.");

    await tx`update order_items set removed_at = ${context.at}, removed_reason = 'Item em falta' where id = ${item.id}`;
    // Never gives back more than what is still left to refund.
    const amount = Math.min(item.line_total_cents, order.total_cents - order.refunded_cents - 1);
    if (amount > 0) {
      await refundOrder(tx, {
        orderId: context.orderId, amountCents: amount, reason: `Item em falta: ${item.name}`, requestedBy: context.profileId, at: context.at,
      });
    }
    await notify({
      profileIds: [order.customer_id], type: "order_item_removed", title: "Um item do seu pedido estava em falta",
      body: `“${item.name}” foi removido e o valor já foi devolvido para você.`,
      link: `/pedidos/${context.orderId}`, orderId: context.orderId, channels: ["push"], at: context.at,
    }, tx);
    await audit({
      actorId: context.profileId, action: "order.item_removed", entityType: "order", entityId: context.orderId,
      storeId: context.storeId, details: { item: item.name, refundedCents: amount },
    }, tx);
  });
}

// ------------------------------------------------------------- store state

/** "Abrir/fechar agora", pause for some minutes, and the busy-kitchen extra time. */
export async function updateStoreState(formData: FormData): Promise<void> {
  const { profile, membership } = await requireStoreMember(["owner", "attendant"]);
  const parsed = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("manual"), value: z.enum(["auto", "open", "closed"]) }),
      z.object({ kind: z.literal("pause"), value: z.coerce.number().int().min(0).max(240) }),
      z.object({ kind: z.literal("busy"), value: z.coerce.number().refine((minutes) => [0, 15, 30, 45].includes(minutes)) }),
    ])
    .safeParse({ kind: formData.get("kind"), value: formData.get("value") });
  if (!parsed.success) return;

  const at = await now();
  const change = parsed.data;
  if (change.kind === "manual") {
    await sql`update stores set manual_state = ${change.value}::store_manual_state where id = ${membership.storeId}`;
  } else if (change.kind === "pause") {
    await sql`
      update stores set
        paused_until = ${change.value === 0 ? null : new Date(at.getTime() + change.value * MINUTE_MS)},
        pause_message = ${change.value === 0 ? null : `Voltamos em ${change.value} minutos`}
      where id = ${membership.storeId}`;
  } else {
    await sql`update stores set busy_extra_minutes = ${change.value} where id = ${membership.storeId}`;
  }
  await audit({ actorId: profile.id, action: `store.${change.kind}`, entityType: "store", entityId: membership.storeId, storeId: membership.storeId, details: { value: change.value } });
  revalidatePath("/lojista", "layout");
}
