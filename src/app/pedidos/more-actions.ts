"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile, getStoreMemberships } from "@/lib/auth/session";
import type { Cart } from "@/lib/cart/local";
import { productStatus } from "@/lib/catalog/availability";
import { loadProducts } from "@/lib/catalog/queries";
import { describeOptions, resolveSelection, toSnapshot, type Pick } from "@/lib/catalog/selection";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { adminIds, notify, storeStaffIds } from "@/lib/notifications/notify";
import { BLOCKED_MESSAGE, chatOpen, moderateMessage } from "@/lib/orders/moderation";
import { rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { recalculateRating } from "@/lib/stores/rating";
import { DAY_MS } from "@/lib/time";
import { pickedFile, saveImage, UploadError } from "@/lib/uploads";

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();

// ---------------------------------------------------------------- mensagens

/**
 * Uma mensagem entre o cliente e a loja sobre um pedido. Só os dois
 * lados daquele pedido podem escrever, só depois do pagamento e até duas
 * horas depois da entrega, e nada que pareça um contato passa.
 */
export async function sendOrderMessage(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = uuid.safeParse(formData.get("orderId"));
  const body = z.string().trim().min(1).max(500).safeParse(formData.get("body"));
  if (!orderId.success) return { error: "Pedido inválido." };
  if (!body.success) return { error: "Escreva a mensagem (até 500 letras)." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Entre na sua conta." };
  if (!(await rateLimit(`message:${profile.id}`, 30, 300))) return { error: TOO_MANY_ATTEMPTS };

  const [order] = await sql<{ id: string; code: string; customer_id: string; store_id: string; status: string; paid_at: Date | null; completed_at: Date | null }[]>`
    select id, code, customer_id, store_id, status, paid_at, completed_at from orders where id = ${orderId.data}`;
  if (!order) return { error: "Pedido não encontrado." };

  const isCustomer = order.customer_id === profile.id;
  const isStaff = (await getStoreMemberships(profile.id)).some(
    (membership) => membership.storeId === order.store_id && membership.role !== "courier",
  );
  if (!isCustomer && !isStaff) return { error: "Pedido não encontrado." };

  const at = await now();
  if (!chatOpen({ paidAt: order.paid_at, completedAt: order.completed_at, status: order.status }, at)) {
    return { error: "As mensagens deste pedido já foram encerradas. Se precisar, use “Preciso de ajuda”." };
  }

  const verdict = moderateMessage(body.data);
  if (!verdict.allowed) {
    await sql`
      insert into blocked_message_attempts (order_id, sender_id, body, matched_rule, created_at)
      values (${order.id}, ${profile.id}, ${body.data}, ${verdict.rule}, ${at})`;
    return { error: BLOCKED_MESSAGE };
  }

  await sql.begin(async (tx) => {
    await tx`
      insert into order_messages (order_id, sender_id, sender_side, body, created_at)
      values (${order.id}, ${profile.id}, ${isCustomer ? "customer" : "store"}::message_side, ${body.data}, ${at})`;
    await notify({
      profileIds: isCustomer ? await storeStaffIds(order.store_id, tx) : [order.customer_id],
      type: "order_message", title: `Nova mensagem no pedido ${order.code}`, body: body.data.slice(0, 120),
      link: isCustomer ? `/lojista/pedidos/${order.id}` : `/pedidos/${order.id}`, orderId: order.id, channels: ["push"], at,
    }, tx);
  });

  revalidatePath(`/pedidos/${order.id}`);
  revalidatePath(`/lojista/pedidos/${order.id}`);
  return { ok: true };
}

// --------------------------------------------------------------- avaliações

export async function submitReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ orderId: uuid, rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(500) })
    .safeParse({ orderId: formData.get("orderId"), rating: formData.get("rating"), comment: formData.get("comment") ?? "" });
  if (!parsed.success) return { error: "Escolha de 1 a 5 estrelas." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Entre na sua conta." };
  const [at, settings] = await Promise.all([now(), getSettings()]);

  const [order] = await sql<{ id: string; store_id: string; completed_at: Date | null }[]>`
    select id, store_id, completed_at from orders
    where id = ${parsed.data.orderId} and customer_id = ${profile.id} and completed_at is not null`;
  if (!order?.completed_at) return { error: "Só dá para avaliar depois que o pedido chega." };
  if (at.getTime() > order.completed_at.getTime() + settings.review_window_days * DAY_MS) {
    return { error: `O prazo de ${settings.review_window_days} dias para avaliar este pedido já passou.` };
  }

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into reviews (order_id, store_id, customer_id, rating, comment, created_at)
        values (${order.id}, ${order.store_id}, ${profile.id}, ${parsed.data.rating}, ${parsed.data.comment || null}, ${at})`;
      await recalculateRating(tx, order.store_id, at);
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Você já avaliou este pedido." };
    throw error;
  }
  revalidatePath(`/pedidos/${order.id}`);
  return { ok: true, message: "Obrigado pela avaliação!" };
}

// ------------------------------------------------------------------ suporte

const REASONS = ["delay", "missing_item", "wrong_item", "damaged_item", "billing", "other"] as const;

/** "Preciso de ajuda": abre um chamado para a equipe da plataforma sobre um pedido. */
export async function openTicket(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ orderId: uuid, reason: z.enum(REASONS), message: z.string().trim().min(5, "Conte o que aconteceu em poucas palavras.").max(1000) })
    .safeParse({ orderId: formData.get("orderId"), reason: formData.get("reason"), message: formData.get("message") });
  if (!parsed.success) return { error: parsed.error.issues[0].message.startsWith("Conte") ? parsed.error.issues[0].message : "Escolha o motivo e conte o que aconteceu." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Entre na sua conta." };
  if (!(await rateLimit(`ticket:${profile.id}`, 5, 3600))) return { error: TOO_MANY_ATTEMPTS };

  const [order] = await sql<{ id: string; code: string; store_id: string }[]>`
    select id, code, store_id from orders where id = ${parsed.data.orderId} and customer_id = ${profile.id} and paid_at is not null`;
  if (!order) return { error: "Pedido não encontrado." };
  const [existing] = await sql`select id from support_tickets where order_id = ${order.id} and status <> 'resolved'`;
  if (existing) return { error: "Já existe um chamado aberto para este pedido. Escreva nele." };

  let photoUrl: string | null = null;
  try {
    const photo = pickedFile(formData.get("photo"));
    if (photo) photoUrl = await saveImage(photo, "products", "suporte", [{ suffix: "", width: 1000, height: 1000 }]);
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }

  const at = await now();
  await sql.begin(async (tx) => {
    const [ticket] = await tx<{ id: string }[]>`
      insert into support_tickets (order_id, customer_id, store_id, reason, photo_url, created_at, updated_at)
      values (${order.id}, ${profile.id}, ${order.store_id}, ${parsed.data.reason}::ticket_reason, ${photoUrl}, ${at}, ${at})
      returning id`;
    await tx`
      insert into ticket_messages (ticket_id, sender_id, sender_side, body, attachment_url, created_at)
      values (${ticket.id}, ${profile.id}, 'customer', ${parsed.data.message}, ${photoUrl}, ${at})`;
    await notify({
      profileIds: await adminIds(tx), type: "ticket_new", title: `Novo chamado no pedido ${order.code}`,
      body: parsed.data.message.slice(0, 120), link: `/admin/suporte/${ticket.id}`, orderId: order.id, at,
    }, tx);
  });

  revalidatePath(`/pedidos/${order.id}/ajuda`);
  return { ok: true, message: "Chamado aberto. A gente responde por aqui." };
}

/** Uma resposta dentro de um chamado, vinda do cliente. (O lado do admin fica no painel do admin.) */
export async function replyTicket(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const ticketId = uuid.safeParse(formData.get("ticketId"));
  const message = z.string().trim().min(1).max(1000).safeParse(formData.get("message"));
  if (!ticketId.success || !message.success) return { error: "Escreva a mensagem." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Entre na sua conta." };
  if (!(await rateLimit(`ticket-reply:${profile.id}`, 30, 600))) return { error: TOO_MANY_ATTEMPTS };

  const at = await now();
  const [ticket] = await sql<{ id: string; order_id: string; status: string }[]>`
    select id, order_id, status from support_tickets where id = ${ticketId.data} and customer_id = ${profile.id}`;
  if (!ticket) return { error: "Chamado não encontrado." };
  if (ticket.status === "resolved") return { error: "Este chamado já foi resolvido." };

  await sql.begin(async (tx) => {
    await tx`
      insert into ticket_messages (ticket_id, sender_id, sender_side, body, created_at)
      values (${ticket.id}, ${profile.id}, 'customer', ${message.data}, ${at})`;
    await tx`update support_tickets set status = 'in_progress' where id = ${ticket.id} and status = 'waiting_customer'`;
    await notify({
      profileIds: await adminIds(tx), type: "ticket_reply", title: "Cliente respondeu um chamado",
      body: message.data.slice(0, 120), link: `/admin/suporte/${ticket.id}`, orderId: ticket.order_id, at,
    }, tx);
  });
  revalidatePath(`/pedidos/${ticket.order_id}/ajuda`);
  return { ok: true };
}

// ------------------------------------------------------------ pedir de novo

export type ReorderResult = { cart: Cart | null; notes: string[] };

/**
 * "Pedir de novo": remonta a sacola a partir de um pedido antigo com o que ainda
 * pode ser pedido hoje, aos preços de hoje, e diz o que mudou.
 */
export async function reorder(orderId: string): Promise<ReorderResult> {
  const profile = await getCurrentProfile();
  if (!profile || !uuid.safeParse(orderId).success) return { cart: null, notes: ["Entre na sua conta para pedir de novo."] };

  const items = await sql<{
    id: string; product_id: string | null; name: string; quantity: number; notes: string | null; unit_price_cents: number;
    store_id: string; store_slug: string; store_name: string; store_status: string;
  }[]>`
    select i.id, i.product_id, i.name, i.quantity, i.notes, i.unit_price_cents, o.store_id, s.slug as store_slug, s.name as store_name, s.status as store_status
    from order_items i join orders o on o.id = i.order_id join stores s on s.id = o.store_id
    where o.id = ${orderId} and o.customer_id = ${profile.id} and i.removed_at is null
    order by i.id`;
  if (items.length === 0) return { cart: null, notes: ["Pedido não encontrado."] };
  if (!["active", "paused"].includes(items[0].store_status)) {
    return { cart: null, notes: [`A ${items[0].store_name} não está mais disponível no Chegô.`] };
  }

  const options = await sql<{ order_item_id: string; option_id: string | null; quantity: number; option_name: string }[]>`
    select order_item_id, option_id, quantity, option_name from order_item_options
    where order_item_id = any(${items.map((item) => item.id)}::uuid[]) order by sort_order`;
  const products = await loadProducts(items.flatMap((item) => item.product_id ?? []));
  const at = await now();
  const notes: string[] = [];
  const cartItems: Cart["items"] = [];

  for (const item of items) {
    const product = item.product_id ? products.get(item.product_id) : undefined;
    if (!product) {
      notes.push(`“${item.name}” não está mais no cardápio.`);
      continue;
    }
    const status = productStatus(product.rules, at);
    if (!status.orderable && status.reason === "sold_out") {
      notes.push(`“${item.name}” esgotou e ficou de fora.`);
      continue;
    }

    const picks: Pick[] = [];
    let lostOption: string | null = null;
    for (const option of options.filter((row) => row.order_item_id === item.id)) {
      const group = product.groups.find((candidate) => candidate.options.some((current) => current.id === option.option_id));
      if (!group) lostOption = option.option_name;
      else picks.push({ groupId: group.id, optionId: option.option_id!, quantity: option.quantity });
    }
    const selection = lostOption ? null : resolveSelection(product.priceCents, product.groups, picks);
    if (!selection || !selection.ok) {
      notes.push(`“${item.name}” mudou no cardápio${lostOption ? ` (“${lostOption}” não existe mais)` : ""}. Escolha as opções de novo na loja.`);
      continue;
    }
    if (selection.unitPriceCents !== item.unit_price_cents) {
      notes.push(`O preço de “${item.name}” mudou.`);
    }

    cartItems.push({
      key: `${product.id}:${item.id.slice(0, 8)}`, productId: product.id, name: product.name, imageUrl: product.imageUrl,
      unitPriceCents: selection.unitPriceCents, quantity: item.quantity, notes: item.notes ?? "", picks,
      lines: describeOptions(toSnapshot(selection.groups)),
    });
  }

  if (cartItems.length === 0) return { cart: null, notes: notes.length > 0 ? notes : ["Nenhum item deste pedido está disponível agora."] };
  return {
    cart: { storeId: items[0].store_id, storeSlug: items[0].store_slug, storeName: items[0].store_name, notes: "", items: cartItems },
    notes,
  };
}
