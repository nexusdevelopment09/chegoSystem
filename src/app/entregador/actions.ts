"use server";

import { revalidatePath } from "next/cache";
import type postgres from "postgres";
import { z } from "zod";
import { now } from "@/lib/clock";
import { MAX_ACTIVE_DELIVERIES, OFFER_STATUSES, requireCourier } from "@/lib/couriers";
import { sql } from "@/lib/db";
import { adminIds, notify, storeStaffIds } from "@/lib/notifications/notify";
import { TransitionError, transitionOrder } from "@/lib/orders/transitions";

type Tx = postgres.TransactionSql;
export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();

// Ações do entregador da rede do Chegô. Mudança de status e de entregador mexe em
// pedido pago, então tudo roda no servidor, pela conexão dona do banco, depois de
// conferir que quem pediu é um entregador aprovado.

async function asActiveCourier(
  run: (tx: Tx, context: { courierId: string; cityId: string; firstName: string; at: Date }) => Promise<string | void>,
): Promise<ActionState> {
  const { profile, courier } = await requireCourier();
  if (courier.status !== "active") return { error: "Seu cadastro ainda não foi aprovado pelo Chegô." };
  const at = await now();
  let message: string | void;
  try {
    message = await sql.begin((tx) => run(tx, { courierId: profile.id, cityId: courier.cityId, firstName: profile.fullName.split(" ")[0], at }));
  } catch (error) {
    if (error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  revalidatePath("/entregador");
  return { ok: true, message: message ?? undefined };
}

/** "Estou disponível" / "Parar por agora": só quem está disponível vê e recebe as entregas novas. */
export async function setAvailability(formData: FormData): Promise<void> {
  const { profile, courier } = await requireCourier();
  if (courier.status !== "active") return;
  await sql`update couriers set available = ${formData.get("available") === "on"} where profile_id = ${profile.id}`;
  revalidatePath("/entregador");
}

/** Pega uma entrega que ainda não tem entregador. Quem chegar primeiro leva. */
export async function claimDelivery(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = uuid.safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: "Entrega inválida." };

  return asActiveCourier(async (tx, context) => {
    const [{ carrying }] = await tx<{ carrying: number }[]>`
      select count(*)::int as carrying from orders
      where courier_id = ${context.courierId} and status in ('accepted', 'preparing', 'ready', 'out_for_delivery')`;
    if (carrying >= MAX_ACTIVE_DELIVERIES) {
      throw new TransitionError(`Você já está com ${MAX_ACTIVE_DELIVERIES} entregas. Conclua uma antes de pegar outra.`);
    }

    const [claimed] = await tx<{ id: string; code: string; store_id: string }[]>`
      update orders set courier_id = ${context.courierId}, courier_assigned_at = ${context.at}
      where id = ${orderId.data} and delivery_provider = 'platform' and fulfillment = 'delivery' and courier_id is null
        and status::text = any(${OFFER_STATUSES}) and city_id = ${context.cityId}
      returning id, code, store_id`;
    if (!claimed) throw new TransitionError("Eita, outro entregador pegou essa entrega primeiro.");

    await notify({
      profileIds: await storeStaffIds(claimed.store_id, tx), type: "delivery_claimed", title: "Entregador a caminho",
      body: `${context.firstName} vai buscar o pedido ${claimed.code}.`, link: "/lojista/pedidos", orderId: claimed.id, channels: ["push"], at: context.at,
    }, tx);
    return "Entrega sua! Vá até a loja para retirar o pedido.";
  });
}

/** Desiste de uma entrega antes de retirar o pedido: ela volta para os outros entregadores. */
export async function releaseDelivery(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = uuid.safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: "Entrega inválida." };

  return asActiveCourier(async (tx, context) => {
    const [released] = await tx<{ id: string; code: string; store_id: string; city_id: string }[]>`
      update orders set courier_id = null, courier_assigned_at = null
      where id = ${orderId.data} and courier_id = ${context.courierId} and status::text = any(${OFFER_STATUSES})
      returning id, code, store_id, city_id`;
    if (!released) throw new TransitionError("Depois de retirar o pedido não dá mais para desistir. Fale com o suporte.");

    await notify({
      profileIds: await storeStaffIds(released.store_id, tx), type: "delivery_released", title: "O entregador desistiu",
      body: `O pedido ${released.code} voltou para a fila de entregadores do Chegô.`, link: "/lojista/pedidos", orderId: released.id, at: context.at,
    }, tx);
  });
}

/** "Retirei o pedido": o pedido pronto sai da loja com o entregador. */
export async function pickUpDelivery(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = uuid.safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: "Entrega inválida." };

  return asActiveCourier(async (tx, context) => {
    const [order] = await tx<{ status: string }[]>`
      select status from orders where id = ${orderId.data} and courier_id = ${context.courierId} and delivery_provider = 'platform' for update`;
    if (!order) throw new TransitionError("Essa entrega não é sua.");
    if (order.status !== "ready") throw new TransitionError("A loja ainda não marcou o pedido como pronto.");
    await transitionOrder(tx, { orderId: orderId.data, to: "out_for_delivery", actor: "courier", actorId: context.courierId, at: context.at });
  });
}

/** Conclui a entrega com o código de 4 números que o cliente mostra. */
export async function completeDelivery(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = uuid.safeParse(formData.get("orderId"));
  const code = z.string().trim().max(4).parse(formData.get("code") ?? "");
  if (!orderId.success) return { error: "Entrega inválida." };

  return asActiveCourier(async (tx, context) => {
    const [order] = await tx<{ delivery_code: string | null; courier_fee_cents: number }[]>`
      select delivery_code, courier_fee_cents from orders
      where id = ${orderId.data} and courier_id = ${context.courierId} and delivery_provider = 'platform' for update`;
    if (!order) throw new TransitionError("Essa entrega não é sua.");
    if (!code) throw new TransitionError("Digite o código de entrega que o cliente recebeu.");
    if (code !== order.delivery_code) throw new TransitionError("Código errado. Peça ao cliente o código de 4 números que aparece no pedido.");

    await transitionOrder(tx, { orderId: orderId.data, to: "delivered", actor: "courier", actorId: context.courierId, at: context.at });
    return "Entrega concluída. Valeu!";
  });
}

// ------------------------------------------------ pagamento feito pela loja

/**
 * O entregador confirma que recebeu da loja o valor da entrega. É a confirmação de quem
 * recebeu: a loja dizer que pagou não basta para dar o ganho como recebido.
 */
export async function confirmEarning(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireCourier();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Entrega inválida." };
  const at = await now();
  const updated = await sql`
    update courier_earnings set status = 'confirmed', confirmed_at = ${at}, dispute_reason = null
    where id = ${id.data} and courier_id = ${profile.id} and payer = 'store' and status in ('pending', 'paid_by_store', 'disputed')
    returning id`;
  if (updated.length === 0) return { error: "Este ganho não pode ser confirmado." };
  revalidatePath("/entregador");
  return { ok: true, message: "Obrigado! Ficou registrado que você recebeu." };
}

/** A loja marcou como pago, mas o entregador não recebeu: vai para o admin conferir. */
export async function disputeEarning(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireCourier();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Entrega inválida." };
  const at = await now();
  const [row] = await sql<{ store_id: string; code: string }[]>`
    update courier_earnings e set status = 'disputed', dispute_reason = 'O entregador diz que não recebeu'
    from orders o
    where e.id = ${id.data} and e.courier_id = ${profile.id} and e.payer = 'store' and e.status = 'paid_by_store' and o.id = e.order_id
    returning e.store_id, o.code`;
  if (!row) return { error: "Este ganho não pode ser contestado." };
  await notify({
    profileIds: [...(await storeStaffIds(row.store_id, sql, ["owner"])), ...(await adminIds())], type: "courier_dispute", title: "Entregador diz que não recebeu",
    body: `O entregador do pedido ${row.code} diz que ainda não recebeu o valor da entrega.`, link: "/lojista/taxas", at,
  });
  revalidatePath("/entregador");
  return { ok: true, message: "Avisamos a loja e a equipe do Chegô." };
}
