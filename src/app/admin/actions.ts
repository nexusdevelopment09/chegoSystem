"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { APPROVAL_CHECKLIST } from "@/lib/admin/checklist";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { parseMoney } from "@/lib/format";
import { notify, storeStaffIds } from "@/lib/notifications/notify";
import { ALL_STATUSES, canTransition, type Fulfillment, type OrderStatus } from "@/lib/orders/status";
import { TransitionError, transitionOrder } from "@/lib/orders/transitions";
import { RefundError, refundOrder } from "@/lib/payments/refunds";
import { SETTING_KEYS } from "@/lib/settings";
import { recalculateRating } from "@/lib/stores/rating";
import { fromLocal } from "@/lib/time";
import { BANNER_VARIANTS, pickedFile, saveImage, UploadError } from "@/lib/uploads";

// Every action here is for the platform owner only, and every one that
// changes something sensitive is written to the audit log.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const admin = () => requireRole("admin");
const done = () => revalidatePath("/admin", "layout");
const reasonText = z.string().trim().min(3, "Escreva o motivo.").max(300);

// ------------------------------------------------------------------ stores


/** Approves a pending store. Every item of the checklist has to be ticked. */
export async function approveStore(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Loja inválida." };
  const missing = APPROVAL_CHECKLIST.filter(([key]) => formData.get(`check-${key}`) !== "on");
  if (missing.length > 0) return { error: `Falta conferir: ${missing.map(([, label]) => label.toLowerCase()).join("; ")}.` };

  const at = await now();
  const approved = await sql.begin(async (tx) => {
    const updated = await tx<{ id: string; name: string }[]>`
      update stores set status = 'active' where id = ${id.data} and status = 'pending' returning id, name`;
    if (updated.length === 0) return null;
    await tx`
      update store_private set approved_at = ${at}, approved_by = ${profile.id}, status_reason = null,
        payment_recipient_id = coalesce(payment_recipient_id, ${`mock_recipient_${id.data.slice(0, 8)}`})
      where store_id = ${id.data}`;
    // A store that signed up by itself has no subscription yet: it starts on the cheapest plan.
    await tx`
      insert into store_subscriptions (store_id, plan_id)
      select ${id.data}, p.id from subscription_plans p where p.active order by p.monthly_price_cents limit 1
      on conflict (store_id) do nothing`;
    await audit({ actorId: profile.id, action: "store.approve", entityType: "store", entityId: id.data, storeId: id.data }, tx);
    await notify({
      profileIds: await storeStaffIds(id.data, tx, ["owner"]), type: "store_approved", title: "Sua loja foi aprovada!",
      body: `A ${updated[0].name} já aparece para os clientes no Chegô.`, link: "/lojista", channels: ["sms", "email"], at,
    }, tx);
    return updated[0];
  });
  if (!approved) return { error: "Esta loja não está mais pendente." };
  done();
  return { ok: true, message: `${approved.name} aprovada.` };
}

/** Pauses, suspends or reactivates a store. Suspending needs a reason and tells the owner. */
export async function setStoreStatus(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = z
    .object({ id: uuid, status: z.enum(["active", "paused", "suspended"]), reason: z.string().trim().max(300) })
    .safeParse({ id: formData.get("id"), status: formData.get("status"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { error: "Dados inválidos." };
  if (parsed.data.status === "suspended" && parsed.data.reason.length < 3) return { error: "Para suspender, escreva o motivo." };

  const at = await now();
  await sql.begin(async (tx) => {
    const [store] = await tx<{ name: string }[]>`
      update stores set status = ${parsed.data.status}::store_status where id = ${parsed.data.id} and status <> 'pending' returning name`;
    if (!store) return;
    await tx`update store_private set status_reason = ${parsed.data.status === "active" ? null : parsed.data.reason || null} where store_id = ${parsed.data.id}`;
    await audit({ actorId: profile.id, action: `store.${parsed.data.status === "active" ? "reactivate" : parsed.data.status === "paused" ? "pause" : "suspend"}`,
      entityType: "store", entityId: parsed.data.id, storeId: parsed.data.id, details: { reason: parsed.data.reason } }, tx);
    if (parsed.data.status === "suspended") {
      await notify({
        profileIds: await storeStaffIds(parsed.data.id, tx, ["owner"]), type: "store_suspended", title: "Sua loja foi suspensa",
        body: `Motivo: ${parsed.data.reason}. Fale com o suporte do Chegô.`, link: "/lojista/financeiro", channels: ["sms", "email"], at,
      }, tx);
    }
  });
  done();
  return { ok: true, message: "Situação da loja atualizada." };
}

/** Commission, plan, free months and paid highlight. All of it goes to the audit log. */
export async function updateStoreTerms(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = z
    .object({
      id: uuid,
      commission: z.coerce.number().min(0).max(50),
      planId: uuid,
      freeUntil: z.union([z.iso.date(), z.literal("")]),
      featuredUntil: z.union([z.iso.date(), z.literal("")]),
    })
    .safeParse({
      id: formData.get("id"), commission: String(formData.get("commission") ?? "").replace(",", "."), planId: formData.get("planId"),
      freeUntil: formData.get("freeUntil") ?? "", featuredUntil: formData.get("featuredUntil") ?? "",
    });
  if (!parsed.success) return { error: "Confira a comissão (0 a 50%), o plano e as datas." };
  const data = parsed.data;

  await sql.begin(async (tx) => {
    const [before] = await tx<{ commission_rate: string; featured_until: Date | null }[]>`
      select sp.commission_rate, s.featured_until from store_private sp join stores s on s.id = sp.store_id where sp.store_id = ${data.id}`;
    // New orders use the new rate; old orders keep the rate copied when they were placed.
    await tx`update store_private set commission_rate = ${data.commission / 100}, cash_enabled = ${formData.get("cashEnabled") === "on"} where store_id = ${data.id}`;
    await tx`update stores set featured_until = ${data.featuredUntil ? fromLocal(data.featuredUntil, 24 * 60) : null} where id = ${data.id}`;
    await tx`
      insert into store_subscriptions (store_id, plan_id, free_until) values (${data.id}, ${data.planId}, ${data.freeUntil || null})
      on conflict (store_id) do update set plan_id = excluded.plan_id, free_until = excluded.free_until`;
    await audit({
      actorId: profile.id, action: "store.terms", entityType: "store", entityId: data.id, storeId: data.id,
      details: {
        commissionBefore: Number(before?.commission_rate ?? 0), commissionAfter: data.commission / 100, planId: data.planId,
        freeUntil: data.freeUntil || null, featuredUntil: data.featuredUntil || null,
      },
    }, tx);
  });
  done();
  return { ok: true, message: "Condições da loja salvas." };
}

// ------------------------------------------------------------------ orders

const COMPLETED: OrderStatus[] = ["delivered", "picked_up", "partially_refunded"];

/** Total or partial refund, with a reason. The order's status follows what happened. */
export async function adminRefund(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const orderId = uuid.safeParse(formData.get("orderId"));
  const reason = reasonText.safeParse(formData.get("reason"));
  if (!orderId.success) return { error: "Pedido inválido." };
  if (!reason.success) return { error: "Escreva o motivo do reembolso." };

  const total = formData.get("kind") === "total";
  const amount = total ? null : parseMoney(String(formData.get("amount") ?? ""));
  if (!total && (!amount || amount <= 0)) return { error: "Valor inválido. Use o formato 12,50." };

  const at = await now();
  try {
    await sql.begin(async (tx) => {
      const [order] = await tx<{ status: OrderStatus; fulfillment: Fulfillment; customer_id: string; code: string; total_cents: number; refunded_cents: number }[]>`
        select status, fulfillment, customer_id, code, total_cents, refunded_cents from orders where id = ${orderId.data} for update`;
      if (!order) throw new RefundError("Pedido não encontrado.");
      const remaining = order.total_cents - order.refunded_cents;
      const full = total || amount === remaining;

      if (full && canTransition(order.status, "cancelled", "admin", order.fulfillment)) {
        // Still on its way: cancelling gives everything back.
        await transitionOrder(tx, { orderId: orderId.data, to: "cancelled", actor: "admin", actorId: profile.id, reason: reason.data, at });
      } else {
        await refundOrder(tx, { orderId: orderId.data, amountCents: full ? "all" : amount!, reason: reason.data, requestedBy: profile.id, at });
        if (COMPLETED.includes(order.status)) {
          await transitionOrder(tx, {
            orderId: orderId.data, to: full ? "refunded" : "partially_refunded", actor: "admin", actorId: profile.id, reason: reason.data, at,
          });
        } else {
          await notify({
            profileIds: [order.customer_id], type: "order_refund", title: "Reembolso feito",
            body: "Devolvemos parte do valor do seu pedido.", link: `/pedidos/${orderId.data}`, orderId: orderId.data, channels: ["push"], at,
          }, tx);
        }
      }
      await audit({
        actorId: profile.id, action: full ? "order.refund_total" : "order.refund_partial", entityType: "order", entityId: orderId.data,
        details: { reason: reason.data, amountCents: full ? remaining : amount, code: order.code },
      }, tx);
    });
  } catch (error) {
    if (error instanceof RefundError || error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  done();
  return { ok: true, message: "Reembolso feito." };
}

/** Exceptional change of status, outside the normal flow. Always with a reason, always logged. */
export async function adminSetStatus(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const orderId = uuid.safeParse(formData.get("orderId"));
  const status = z.enum(ALL_STATUSES as [OrderStatus, ...OrderStatus[]]).safeParse(formData.get("status"));
  const reason = reasonText.safeParse(formData.get("reason"));
  if (!orderId.success || !status.success) return { error: "Escolha a nova situação." };
  if (!reason.success) return { error: "Escreva o motivo da alteração." };
  if (status.data === "paid" || status.data === "awaiting_payment") return { error: "Um pedido só vira pago pela confirmação do pagamento." };

  const at = await now();
  try {
    await sql.begin(async (tx) => {
      const [order] = await tx<{ status: OrderStatus; paid_at: Date | null }[]>`select status, paid_at from orders where id = ${orderId.data} for update`;
      if (!order) throw new TransitionError("Pedido não encontrado.");
      if (!order.paid_at && !["cancelled", "expired"].includes(status.data)) {
        throw new TransitionError("Pedido sem pagamento só pode ser cancelado ou expirado.");
      }
      await transitionOrder(tx, { orderId: orderId.data, to: status.data, actor: "admin", actorId: profile.id, reason: reason.data, at, force: true });
      await audit({
        actorId: profile.id, action: "order.force_status", entityType: "order", entityId: orderId.data,
        details: { from: order.status, to: status.data, reason: reason.data },
      }, tx);
    });
  } catch (error) {
    if (error instanceof RefundError || error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  done();
  return { ok: true, message: "Situação alterada." };
}

// --------------------------------------------------------------- customers

export async function setCustomerBlocked(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const id = uuid.safeParse(formData.get("id"));
  const block = formData.get("block") === "1";
  const reason = z.string().trim().max(300).parse(formData.get("reason") ?? "");
  if (!id.success) return { error: "Cliente inválido." };
  if (block && reason.length < 3) return { error: "Para bloquear, escreva o motivo." };

  const at = await now();
  await sql.begin(async (tx) => {
    await tx`
      update profiles set blocked_at = ${block ? at : null}, blocked_reason = ${block ? reason : null}
      where id = ${id.data} and role = 'customer'`;
    await audit({ actorId: profile.id, action: block ? "customer.block" : "customer.unblock", entityType: "profile", entityId: id.data, details: { reason } }, tx);
  });
  done();
  return { ok: true, message: block ? "Cliente bloqueado." : "Cliente desbloqueado." };
}

/** Lets one customer pay in cash on delivery when that feature exists (off in the MVP). */
export async function toggleCustomerCash(formData: FormData): Promise<void> {
  const profile = await admin();
  const id = uuid.parse(formData.get("id"));
  await sql`update profiles set cash_enabled = not cash_enabled where id = ${id} and role = 'customer'`;
  await audit({ actorId: profile.id, action: "customer.cash_toggle", entityType: "profile", entityId: id });
  done();
}

// ----------------------------------------------------------------- support

export async function adminReplyTicket(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const ticketId = uuid.safeParse(formData.get("ticketId"));
  const message = z.string().trim().max(1000).parse(formData.get("message") ?? "");
  const status = z.enum(["open", "in_progress", "waiting_customer", "resolved"]).safeParse(formData.get("status"));
  if (!ticketId.success || !status.success) return { error: "Chamado inválido." };
  if (!message && formData.get("involveStore") !== "on" && status.data !== "resolved") return { error: "Escreva a resposta." };

  const at = await now();
  await sql.begin(async (tx) => {
    const [ticket] = await tx<{ customer_id: string; order_id: string; store_id: string; store_involved: boolean }[]>`
      select customer_id, order_id, store_id, store_involved from support_tickets where id = ${ticketId.data} for update`;
    if (!ticket) return;
    if (message) {
      await tx`
        insert into ticket_messages (ticket_id, sender_id, sender_side, body, created_at)
        values (${ticketId.data}, ${profile.id}, 'admin', ${message}, ${at})`;
      await notify({
        profileIds: [ticket.customer_id], type: "ticket_answer", title: "O suporte do Chegô respondeu",
        body: message.slice(0, 120), link: `/pedidos/${ticket.order_id}/ajuda`, orderId: ticket.order_id, channels: ["push", "email"], at,
      }, tx);
    }
    const involve = formData.get("involveStore") === "on";
    if (involve && !ticket.store_involved) {
      await notify({
        profileIds: await storeStaffIds(ticket.store_id, tx), type: "ticket_store", title: "O suporte precisa de você em um pedido",
        body: "Um cliente abriu um chamado sobre um pedido da sua loja.", link: `/lojista/pedidos/${ticket.order_id}`, orderId: ticket.order_id, channels: ["push"], at,
      }, tx);
    }
    await tx`
      update support_tickets set status = ${status.data}::ticket_status, store_involved = store_involved or ${involve},
        resolved_at = ${status.data === "resolved" ? at : null}
      where id = ${ticketId.data}`;
  });
  done();
  return { ok: true, message: "Chamado atualizado." };
}

// -------------------------------------------------------------- moderation

export async function setReviewHidden(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const id = uuid.safeParse(formData.get("id"));
  const hide = formData.get("hide") === "1";
  const reason = z.string().trim().max(300).parse(formData.get("reason") ?? "");
  if (!id.success) return { error: "Avaliação inválida." };
  if (hide && reason.length < 3) return { error: "Para ocultar, escreva o motivo." };

  const at = await now();
  await sql.begin(async (tx) => {
    const [review] = await tx<{ store_id: string }[]>`
      update reviews set hidden_at = ${hide ? at : null}, hidden_by = ${hide ? profile.id : null}, hidden_reason = ${hide ? reason : null}
      where id = ${id.data} returning store_id`;
    if (!review) return;
    await recalculateRating(tx, review.store_id, at);
    await audit({ actorId: profile.id, action: hide ? "review.hide" : "review.show", entityType: "review", entityId: id.data, storeId: review.store_id, details: { reason } }, tx);
  });
  done();
  return { ok: true, message: hide ? "Avaliação ocultada." : "Avaliação visível de novo." };
}

// --------------------------------------------------------------- marketing

export async function saveBanner(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = z
    .object({
      title: z.string().trim().min(2, "Dê um título ao banner.").max(80),
      link: z.union([z.string().trim().regex(/^\/(?!\/)/, "O link deve ser de dentro do app e começar com /").max(200), z.literal("")]),
      cityId: z.union([uuid, z.literal("")]),
      startsAt: z.union([z.iso.date(), z.literal("")]),
      endsAt: z.union([z.iso.date(), z.literal("")]),
    })
    .safeParse({
      title: formData.get("title"), link: formData.get("link") ?? "", cityId: formData.get("cityId") ?? "",
      startsAt: formData.get("startsAt") ?? "", endsAt: formData.get("endsAt") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let imageUrl: string;
  try {
    const file = pickedFile(formData.get("image"));
    if (!file) return { error: "Escolha a imagem do banner." };
    imageUrl = await saveImage(file, "banners", "", BANNER_VARIANTS);
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }

  const at = await now();
  const data = parsed.data;
  const [banner] = await sql<{ id: string }[]>`
    insert into banners (city_id, title, image_url, link_url, starts_at, ends_at, sort_order)
    values (${data.cityId || null}, ${data.title}, ${imageUrl}, ${data.link || null},
            ${data.startsAt ? fromLocal(data.startsAt, 0) : at}, ${data.endsAt ? fromLocal(data.endsAt, 24 * 60) : null},
            (select coalesce(max(sort_order), -1) + 1 from banners))
    returning id`;
  await audit({ actorId: profile.id, action: "banner.create", entityType: "banner", entityId: banner.id, details: { title: data.title } });
  done();
  revalidatePath("/");
  return { ok: true, message: "Banner publicado." };
}

export async function toggleBanner(formData: FormData): Promise<void> {
  await admin();
  await sql`update banners set active = not active where id = ${uuid.parse(formData.get("id"))}`;
  done();
}

const adminCouponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "O código usa de 3 a 20 letras e números, sem espaços."),
  description: z.string().trim().max(120),
  type: z.enum(["fixed", "percent", "free_delivery"]),
  paidBy: z.enum(["platform", "store"]),
  percent: z.union([z.coerce.number().min(1).max(100), z.literal("")]),
  expiresAt: z.union([z.iso.date(), z.literal("")]),
  maxUses: z.union([z.coerce.number().int().min(1), z.literal("")]),
  maxUsesPerCustomer: z.coerce.number().int().min(1).max(1000),
  storeId: z.union([uuid, z.literal("")]),
  categoryId: z.union([uuid, z.literal("")]),
  cityId: z.union([uuid, z.literal("")]),
});

export async function saveCoupon(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = adminCouponSchema.safeParse({
    code: formData.get("code"), description: formData.get("description") ?? "", type: formData.get("type"), paidBy: formData.get("paidBy"),
    percent: formData.get("percent") ?? "", expiresAt: formData.get("expiresAt") ?? "", maxUses: formData.get("maxUses") ?? "",
    maxUsesPerCustomer: formData.get("maxUsesPerCustomer") || 1, storeId: formData.get("storeId") ?? "",
    categoryId: formData.get("categoryId") ?? "", cityId: formData.get("cityId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;
  const money = (field: string) => {
    const text = String(formData.get(field) ?? "").trim();
    return text === "" ? null : parseMoney(text);
  };
  const valueCents = money("value");
  if (data.type === "fixed" && !valueCents) return { error: "Diga o valor do desconto." };
  if (data.type === "percent" && data.percent === "") return { error: "Diga o percentual do desconto." };
  if (data.paidBy === "store" && !data.storeId) return { error: "Cupom pago pela loja precisa dizer qual loja." };

  try {
    const [coupon] = await sql<{ id: string }[]>`
      insert into coupons (code, description, type, value_cents, percent, max_discount_cents, paid_by, expires_at, max_uses,
                           max_uses_per_customer, min_order_cents, first_order_only, store_ids, category_ids, city_ids)
      values (${data.code}, ${data.description}, ${data.type}::coupon_type, ${data.type === "fixed" ? valueCents : null},
              ${data.type === "percent" ? data.percent : null}, ${data.type === "percent" ? money("maxDiscount") : null},
              ${data.paidBy}::discount_payer, ${data.expiresAt ? fromLocal(data.expiresAt, 24 * 60) : null},
              ${data.maxUses === "" ? null : data.maxUses}, ${data.maxUsesPerCustomer}, ${money("minOrder") ?? 0},
              ${formData.get("firstOrderOnly") === "on"},
              ${data.storeId ? [data.storeId] : []}::uuid[], ${data.categoryId ? [data.categoryId] : []}::uuid[], ${data.cityId ? [data.cityId] : []}::uuid[])
      returning id`;
    await audit({ actorId: profile.id, action: "coupon.create", entityType: "coupon", entityId: coupon.id, details: { code: data.code, paidBy: data.paidBy } });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Já existe um cupom com esse código." };
    throw error;
  }
  done();
  return { ok: true, message: `Cupom ${data.code} criado.` };
}

export async function toggleCoupon(formData: FormData): Promise<void> {
  const profile = await admin();
  const id = uuid.parse(formData.get("id"));
  await sql`update coupons set active = not active where id = ${id}`;
  await audit({ actorId: profile.id, action: "coupon.toggle", entityType: "coupon", entityId: id });
  done();
}

// ---------------------------------------------------------------- registry

const slugify = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function saveCity(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), prefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/) })
    .safeParse({ name: formData.get("name"), state: formData.get("state"), prefix: formData.get("prefix") });
  if (!parsed.success) return { error: "Preencha o nome, a UF (2 letras) e o prefixo dos pedidos (2 a 4 letras)." };
  try {
    const [city] = await sql<{ id: string }[]>`
      insert into cities (name, state, slug, order_code_prefix, active)
      values (${parsed.data.name}, ${parsed.data.state}, ${slugify(`${parsed.data.name}-${parsed.data.state}`)}, ${parsed.data.prefix}, false)
      returning id`;
    await audit({ actorId: profile.id, action: "city.create", entityType: "city", entityId: city.id, details: parsed.data });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Já existe uma cidade com esse nome ou esse prefixo." };
    throw error;
  }
  done();
  return { ok: true, message: "Cidade criada (inativa). Ative quando estiver pronta." };
}

/** Turns a flag of a city, neighborhood, category or plan on or off. */
export async function toggleRegistry(formData: FormData): Promise<void> {
  const profile = await admin();
  const id = uuid.parse(formData.get("id"));
  const target = z.enum(["city", "city_maintenance", "neighborhood", "category", "plan"]).parse(formData.get("target"));
  if (target === "city") await sql`update cities set active = not active where id = ${id}`;
  if (target === "city_maintenance") await sql`update cities set maintenance_mode = not maintenance_mode where id = ${id}`;
  if (target === "neighborhood") await sql`update neighborhoods set active = not active where id = ${id}`;
  if (target === "category") await sql`update categories set active = not active where id = ${id}`;
  if (target === "plan") await sql`update subscription_plans set active = not active where id = ${id}`;
  await audit({ actorId: profile.id, action: `${target}.toggle`, entityType: target, entityId: id });
  done();
  revalidatePath("/");
}

export async function saveNeighborhood(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await admin();
  const parsed = z.object({ cityId: uuid, name: z.string().trim().min(2).max(80) }).safeParse({ cityId: formData.get("cityId"), name: formData.get("name") });
  if (!parsed.success) return { error: "Escolha a cidade e diga o nome." };
  try {
    await sql`insert into neighborhoods (city_id, name, is_rural) values (${parsed.data.cityId}, ${parsed.data.name}, ${formData.get("rural") === "on"})`;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Esse nome já existe nessa cidade." };
    throw error;
  }
  done();
  return { ok: true, message: "Bairro ou comunidade adicionado." };
}

export async function saveCategory(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await admin();
  const parsed = z
    .object({ id: z.union([uuid, z.literal("")]), name: z.string().trim().min(2).max(60), icon: z.string().trim().max(30), order: z.coerce.number().int().min(0).max(999) })
    .safeParse({ id: formData.get("id") ?? "", name: formData.get("name"), icon: formData.get("icon") ?? "", order: formData.get("order") || 0 });
  if (!parsed.success) return { error: "Preencha o nome e a ordem." };
  try {
    if (parsed.data.id) {
      await sql`update categories set name = ${parsed.data.name}, icon = ${parsed.data.icon}, sort_order = ${parsed.data.order} where id = ${parsed.data.id}`;
    } else {
      await sql`insert into categories (name, slug, icon, sort_order) values (${parsed.data.name}, ${slugify(parsed.data.name)}, ${parsed.data.icon}, ${parsed.data.order})`;
    }
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Já existe uma categoria com esse nome." };
    throw error;
  }
  done();
  return { ok: true, message: "Categoria salva." };
}

export async function savePlan(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const name = z.string().trim().min(2).max(60).safeParse(formData.get("name"));
  const price = parseMoney(String(formData.get("price") ?? ""));
  if (!name.success || price === null) return { error: "Preencha o nome e a mensalidade (ex.: 49,90)." };
  const [plan] = await sql<{ id: string }[]>`insert into subscription_plans (name, monthly_price_cents) values (${name.data}, ${price}) returning id`;
  await audit({ actorId: profile.id, action: "plan.create", entityType: "plan", entityId: plan.id, details: { name: name.data, price } });
  done();
  return { ok: true, message: "Plano criado." };
}

// ---------------------------------------------------------------- settings

const MONEY_SETTINGS = ["service_fee_cents", "referral_referred_cents", "referral_referrer_cents"];

export async function saveSettings(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const values: Record<string, number> = {};
  for (const key of SETTING_KEYS) {
    const text = String(formData.get(key) ?? "").trim();
    if (text === "") continue;
    const value = MONEY_SETTINGS.includes(key)
      ? parseMoney(text)
      : key === "default_commission_rate" ? Number(text.replace(",", ".")) / 100 : Number(text);
    if (value === null || !Number.isFinite(value) || value < 0) return { error: `Valor inválido em ${key}.` };
    if (key === "default_commission_rate" && value > 0.5) return { error: "A comissão padrão vai de 0 a 50%." };
    values[key] = value;
  }

  await sql.begin(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx`
        insert into platform_settings (key, value, updated_by) values (${key}, ${tx.json(value)}, ${profile.id})
        on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
    }
    await audit({ actorId: profile.id, action: "settings.update", entityType: "settings", details: values }, tx);
  });
  done();
  return { ok: true, message: "Configurações salvas." };
}

export async function toggleFlag(formData: FormData): Promise<void> {
  const profile = await admin();
  const key = z.string().max(60).parse(formData.get("key"));
  const [flag] = await sql<{ enabled: boolean }[]>`update feature_flags set enabled = not enabled, updated_at = now() where key = ${key} returning enabled`;
  await audit({ actorId: profile.id, action: "flag.toggle", entityType: "feature_flag", entityId: key, details: { enabled: flag?.enabled } });
  done();
}

// ------------------------------------------------------------------- legal

/** Publishes a new version of a legal text. Everyone has to accept it again on the next visit. */
export async function publishLegal(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = z
    .object({ type: z.enum(["terms", "merchant_terms", "privacy"]), title: z.string().trim().min(3).max(120), content: z.string().trim().min(20, "O texto está muito curto.").max(200_000) })
    .safeParse({ type: formData.get("type"), title: formData.get("title"), content: formData.get("content") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Published at the real time, whatever the simulated clock says: a legal text must not depend on a test clock.
  const [document] = await sql<{ id: string; version: number }[]>`
    insert into legal_documents (type, version, title, content, published_at)
    values (${parsed.data.type}::legal_document_type,
            (select coalesce(max(version), 0) + 1 from legal_documents where type = ${parsed.data.type}::legal_document_type),
            ${parsed.data.title}, ${parsed.data.content}, now())
    returning id, version`;
  await audit({ actorId: profile.id, action: "legal.publish", entityType: "legal_document", entityId: document.id, details: { type: parsed.data.type, version: document.version } });
  done();
  return { ok: true, message: `Versão ${document.version} publicada. Todos vão precisar aceitar de novo.` };
}
