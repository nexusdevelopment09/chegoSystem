"use server";

import { revalidatePath } from "next/cache";
import type postgres from "postgres";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireStoreMember, type StoreRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { availableCourierIds, notify } from "@/lib/notifications/notify";
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
 * Roda uma mudança em um dos pedidos da loja. O pedido precisa ser da loja
 * em que o usuário trabalha (e já estar pago: a loja nunca toca em um
 * pedido antes de o pagamento ser confirmado).
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
    // A estimativa mostrada ao cliente acompanha o tempo que a loja prometeu.
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

/** Avança o pedido um passo: em preparo, pronto, saiu para entrega ou retirado. */
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
 * Marca o pedido como entregue. O entregador digita o código de 4 dígitos que o
 * cliente mostra. Sem o código, só o dono consegue, e com motivo.
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

/** Acabou um item na loja: ele sai do pedido e o valor volta para o cliente. */
export async function removeMissingItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = uuid.safeParse(formData.get("itemId"));
  if (!itemId.success) return { error: "Item inválido." };

  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], async (tx, context) => {
    const [order] = await tx<{ status: OrderStatus; customer_id: string; code: string; total_cents: number; refunded_cents: number; payment_collection: "app" | "store" }[]>`
      select status, customer_id, code, total_cents, refunded_cents, payment_collection from orders where id = ${context.orderId}`;
    if (!["accepted", "preparing"].includes(order.status)) {
      throw new TransitionError("Só dá para remover item enquanto o pedido está aceito ou em preparo.");
    }
    const active = await tx<{ id: string; name: string; line_total_cents: number }[]>`
      select id, name, line_total_cents from order_items where order_id = ${context.orderId} and removed_at is null`;
    const item = active.find((row) => row.id === itemId.data);
    if (!item) throw new TransitionError("Esse item já foi removido.");
    if (active.length === 1) throw new TransitionError("É o único item do pedido. Nesse caso, fale com o suporte para cancelar.");

    await tx`update order_items set removed_at = ${context.at}, removed_reason = 'Item em falta' where id = ${item.id}`;
    let amount = 0;
    if (order.payment_collection === "store") {
      // Pagando direto à loja, nada foi cobrado ainda: o item simplesmente sai do total que o cliente vai pagar.
      amount = item.line_total_cents;
      await tx`
        update orders set subtotal_cents = subtotal_cents - ${amount}, total_cents = greatest(total_cents - ${amount}, 0),
          store_amount_cents = store_amount_cents - ${amount}
        where id = ${context.orderId}`;
    } else {
      // Pago pelo app: devolve o valor do item. Nunca devolve mais do que ainda falta reembolsar.
      amount = Math.min(item.line_total_cents, order.total_cents - order.refunded_cents - 1);
      if (amount > 0) {
        await refundOrder(tx, {
          orderId: context.orderId, amountCents: amount, reason: `Item em falta: ${item.name}`, requestedBy: context.profileId, at: context.at,
        });
      }
    }
    await notify({
      profileIds: [order.customer_id], type: "order_item_removed", title: "Um item do seu pedido estava em falta",
      body: order.payment_collection === "store"
        ? `“${item.name}” foi removido e saiu do total que você vai pagar.`
        : `“${item.name}” foi removido e o valor já foi devolvido para você.`,
      link: `/pedidos/${context.orderId}`, orderId: context.orderId, channels: ["push"], at: context.at,
    }, tx);
    await audit({
      actorId: context.profileId, action: "order.item_removed", entityType: "order", entityId: context.orderId,
      storeId: context.storeId, details: { item: item.name, refundedCents: amount },
    }, tx);
  });
}

// ---------------------------------------------------------- estado da loja

/** "Abrir/fechar agora", pausa por alguns minutos e o tempo extra de movimento alto. */
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

// ------------------------------------------- entrega da rede sem entregador

/** Ninguém pegou a entrega da rede ainda: avisa de novo os entregadores disponíveis da cidade. */
export async function recallCouriers(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], async (tx, context) => {
    const [order] = await tx<{ code: string; city_id: string }[]>`
      select code, city_id from orders
      where id = ${context.orderId} and delivery_provider = 'platform' and courier_id is null
        and status in ('accepted', 'preparing', 'ready')`;
    if (!order) throw new TransitionError("Esta entrega já tem entregador ou não é da rede do Chegô.");
    await notify({
      profileIds: await availableCourierIds(order.city_id, tx), type: "delivery_offer", title: "Entrega esperando entregador",
      body: `Pedido ${order.code} ainda sem entregador. Toque para ver.`, link: "/entregador", orderId: context.orderId, channels: ["push"], at: context.at,
    }, tx);
  });
}

/**
 * A loja desiste da rede para este pedido e entrega com a própria equipe. Só enquanto
 * nenhum entregador da rede pegou a entrega; a loja não deve nada a ninguém por ela.
 */
export async function deliverWithOwnCourier(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return onStoreOrder(formData.get("orderId"), ["owner", "attendant"], async (tx, context) => {
    const changed = await tx`
      update orders set delivery_provider = 'store', courier_fee_cents = 0
      where id = ${context.orderId} and delivery_provider = 'platform' and courier_id is null
        and status in ('accepted', 'preparing', 'ready')
      returning id`;
    if (changed.length === 0) throw new TransitionError("Um entregador da rede já pegou esta entrega.");
    await audit({ actorId: context.profileId, action: "order.delivery_to_store", entityType: "order", entityId: context.orderId, storeId: context.storeId }, tx);
  });
}
