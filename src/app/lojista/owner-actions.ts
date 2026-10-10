"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireStoreMember } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { parseMoney, toE164 } from "@/lib/format";
import { getPaymentProvider } from "@/lib/payments";
import { buildMockWebhook } from "@/lib/payments/mock";
import { handlePaymentWebhook } from "@/lib/payments/webhook";
import { fromLocal, MINUTE_MS } from "@/lib/time";
import { COVER_VARIANTS, LOGO_VARIANTS, pickedFile, saveImage, UploadError } from "@/lib/uploads";

// Configurações da loja, equipe, cupons e dinheiro. Estas tabelas não dão acesso de
// escrita a usuários comuns, então cada ação confere o papel aqui e grava pela
// conexão dona do banco, sempre filtrando pela loja à qual o usuário pertence.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const time = z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]);
const owner = () => requireStoreMember(["owner"]);
const done = () => revalidatePath("/lojista", "layout");

// ----------------------------------------------------------- dados da loja

const storeSchema = z.object({
  description: z.string().trim().max(300),
  prepMinutes: z.coerce.number().int().min(0).max(600),
  scheduleLeadMinutes: z.coerce.number().int().min(0).max(10080),
  scheduleMaxDays: z.coerce.number().int().min(0).max(60),
  cutoff: time, windowStart: time, windowEnd: time,
  pizzaPricing: z.enum(["highest", "average"]),
  printerWidth: z.enum(["58", "80"]),
});

export async function saveStore(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const parsed = storeSchema.safeParse({
    description: formData.get("description") ?? "", prepMinutes: formData.get("prepMinutes"),
    scheduleLeadMinutes: formData.get("scheduleLeadMinutes") || 0, scheduleMaxDays: formData.get("scheduleMaxDays") || 0,
    cutoff: formData.get("cutoff") ?? "", windowStart: formData.get("windowStart") ?? "", windowEnd: formData.get("windowEnd") ?? "",
    pizzaPricing: formData.get("pizzaPricing"), printerWidth: formData.get("printerWidth"),
  });
  if (!parsed.success) return { error: "Confira os campos: algum valor não é válido." };
  const minOrderCents = parseMoney(String(formData.get("minOrder") || "0"));
  if (minOrderCents === null) return { error: "Pedido mínimo inválido. Use o formato 20,00." };

  const data = parsed.data;
  const delivery = formData.get("offersDelivery") === "on";
  const pickup = formData.get("offersPickup") === "on";
  if (!delivery && !pickup) return { error: "A loja precisa fazer entrega, retirada ou os dois." };

  let logoUrl: string | undefined;
  let coverUrl: string | undefined;
  try {
    const logo = pickedFile(formData.get("logo"));
    const cover = pickedFile(formData.get("cover"));
    if (logo) logoUrl = await saveImage(logo, "stores", "", LOGO_VARIANTS);
    if (cover) coverUrl = await saveImage(cover, "stores", "", COVER_VARIANTS);
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }

  await sql.begin(async (tx) => {
    await tx`
      update stores set
        description = ${data.description}, prep_time_minutes = ${data.prepMinutes}, min_order_cents = ${minOrderCents},
        offers_delivery = ${delivery}, offers_pickup = ${pickup},
        accepts_scheduled = ${formData.get("acceptsScheduled") === "on"},
        schedule_min_lead_minutes = ${data.scheduleLeadMinutes}, schedule_max_days = ${data.scheduleMaxDays},
        same_day_cutoff = ${data.cutoff || null}, delivery_window_start = ${data.windowStart || null},
        delivery_window_end = ${data.windowEnd || null}, pizza_pricing = ${data.pizzaPricing}::pizza_pricing_rule,
        printer_width_mm = ${Number(data.printerWidth)}, auto_print = ${formData.get("autoPrint") === "on"},
        logo_url = coalesce(${logoUrl ?? null}, logo_url), cover_url = coalesce(${coverUrl ?? null}, cover_url)
      where id = ${membership.storeId}`;
    // A regra do meio a meio é aplicada a todos os grupos de sabores da loja.
    await tx`
      update product_option_groups l set price_mode = ${data.pizzaPricing}::option_price_mode
      from products p
      where p.id = l.product_id and p.store_id = ${membership.storeId} and l.price_mode in ('highest', 'average')`;
    await audit({ actorId: profile.id, action: "store.update", entityType: "store", entityId: membership.storeId, storeId: membership.storeId }, tx);
  });
  done();
  return { ok: true, message: "Dados da loja salvos." };
}

/** Horários de funcionamento: até dois turnos por dia da semana. Substitui a grade inteira. */
export async function saveHours(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const rows: { weekday: number; opensAt: string; closesAt: string; pickupOnly: boolean }[] = [];

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    for (const shift of [1, 2]) {
      const opensAt = time.safeParse(formData.get(`open-${weekday}-${shift}`) ?? "");
      const closesAt = time.safeParse(formData.get(`close-${weekday}-${shift}`) ?? "");
      if (!opensAt.success || !closesAt.success) return { error: "Horário inválido." };
      if (!opensAt.data && !closesAt.data) continue;
      if (!opensAt.data || !closesAt.data) return { error: "Preencha a abertura e o fechamento de cada turno." };
      rows.push({ weekday, opensAt: opensAt.data, closesAt: closesAt.data, pickupOnly: formData.get(`pickup-${weekday}`) === "on" });
    }
  }

  await sql.begin(async (tx) => {
    await tx`delete from store_hours where store_id = ${membership.storeId}`;
    for (const row of rows) {
      await tx`
        insert into store_hours (store_id, weekday, opens_at, closes_at, pickup_only)
        values (${membership.storeId}, ${row.weekday}, ${row.opensAt}, ${row.closesAt}, ${row.pickupOnly})`;
    }
    await audit({ actorId: profile.id, action: "store.hours", entityType: "store", entityId: membership.storeId, storeId: membership.storeId }, tx);
  });
  done();
  return { ok: true, message: "Horários salvos." };
}

/** Feriado ou fechamento especial, por dias inteiros. */
export async function addClosure(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { membership } = await owner();
  const parsed = z
    .object({ from: z.iso.date(), to: z.iso.date(), reason: z.string().trim().max(100) })
    .safeParse({ from: formData.get("from"), to: formData.get("to") || formData.get("from"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { error: "Escolha a data do fechamento." };
  if (parsed.data.to < parsed.data.from) return { error: "A data final não pode ser antes da inicial." };

  await sql`
    insert into store_closures (store_id, starts_at, ends_at, reason)
    values (${membership.storeId}, ${fromLocal(parsed.data.from, 0)}, ${fromLocal(parsed.data.to, 24 * 60)}, ${parsed.data.reason || null})`;
  done();
  return { ok: true };
}

export async function deleteClosure(formData: FormData): Promise<void> {
  const { membership } = await owner();
  await sql`delete from store_closures where id = ${uuid.parse(formData.get("id"))} and store_id = ${membership.storeId}`;
  done();
}

/** Onde a loja entrega, com a taxa e o tempo de cada bairro. */
export async function saveAreas(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const hoods = await sql<{ id: string; name: string }[]>`
    select n.id, n.name from neighborhoods n join stores s on s.city_id = n.city_id where s.id = ${membership.storeId}`;

  const areas: { id: string; fee: number; min: number; max: number }[] = [];
  for (const hood of hoods) {
    if (formData.get(`serve-${hood.id}`) !== "on") continue;
    const fee = parseMoney(String(formData.get(`fee-${hood.id}`) || "0"));
    const min = Number(formData.get(`min-${hood.id}`) || 20);
    const max = Number(formData.get(`max-${hood.id}`) || 40);
    if (fee === null) return { error: `Taxa inválida em ${hood.name}.` };
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 600) return { error: `Tempo inválido em ${hood.name}.` };
    areas.push({ id: hood.id, fee, min, max });
  }

  await sql.begin(async (tx) => {
    await tx`delete from store_delivery_areas where store_id = ${membership.storeId}`;
    for (const area of areas) {
      await tx`
        insert into store_delivery_areas (store_id, neighborhood_id, delivery_fee_cents, min_minutes, max_minutes)
        values (${membership.storeId}, ${area.id}, ${area.fee}, ${area.min}, ${area.max})`;
    }
    await audit({ actorId: profile.id, action: "store.areas", entityType: "store", entityId: membership.storeId, storeId: membership.storeId, details: { areas: areas.length } }, tx);
  });
  done();
  return { ok: true, message: "Áreas de entrega salvas." };
}

// ------------------------------------------------------------------- equipe

/** Convida alguém pelo telefone. A pessoa entra com esse telefone e já cai no painel da loja. */
export async function inviteMember(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const phone = toE164(String(formData.get("phone") ?? ""));
  const role = z.enum(["attendant", "courier"]).safeParse(formData.get("role"));
  const name = z.string().trim().max(80).parse(formData.get("name") ?? "");
  if (!phone) return { error: "Telefone inválido. Use DDD + número." };
  if (!role.success) return { error: "Escolha o papel." };

  await sql.begin(async (tx) => {
    let [person] = await tx<{ id: string }[]>`select id from profiles where phone = ${phone} and deleted_at is null`;
    if (person) {
      await tx`update profiles set role = 'merchant' where id = ${person.id} and role = 'customer'`;
    } else {
      [person] = await tx<{ id: string }[]>`
        insert into profiles (phone, full_name, role) values (${phone}, ${name}, 'merchant') returning id`;
    }
    await tx`
      insert into store_members (store_id, profile_id, role) values (${membership.storeId}, ${person.id}, ${role.data}::store_member_role)
      on conflict (store_id, profile_id) do update set role = excluded.role where store_members.role <> 'owner'`;
    await audit({ actorId: profile.id, action: "store.member_invite", entityType: "profile", entityId: person.id, storeId: membership.storeId, details: { role: role.data } }, tx);
  });
  done();
  return { ok: true, message: "Pessoa adicionada à equipe." };
}

export async function removeMember(formData: FormData): Promise<void> {
  const { profile, membership } = await owner();
  const memberId = uuid.parse(formData.get("profileId"));
  await sql.begin(async (tx) => {
    const removed = await tx`
      delete from store_members where store_id = ${membership.storeId} and profile_id = ${memberId} and role <> 'owner' returning profile_id`;
    if (removed.length > 0) {
      await audit({ actorId: profile.id, action: "store.member_remove", entityType: "profile", entityId: memberId, storeId: membership.storeId }, tx);
    }
  });
  done();
}

// ------------------------------------------------------------------- cupons

const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "O código usa de 3 a 20 letras e números, sem espaços."),
  type: z.enum(["fixed", "percent", "free_delivery"]),
  percent: z.union([z.coerce.number().min(1).max(100), z.literal("")]),
  expiresAt: z.union([z.iso.date(), z.literal("")]),
  maxUses: z.union([z.coerce.number().int().min(1), z.literal("")]),
  maxUsesPerCustomer: z.coerce.number().int().min(1).max(1000),
});

/** Um cupom criado pela loja é sempre pago pela loja e só vale nela. */
export async function createStoreCoupon(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const parsed = couponSchema.safeParse({
    code: formData.get("code"), type: formData.get("type"), percent: formData.get("percent") ?? "",
    expiresAt: formData.get("expiresAt") ?? "", maxUses: formData.get("maxUses") ?? "", maxUsesPerCustomer: formData.get("maxUsesPerCustomer") || 1,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const money = (field: string) => {
    const text = String(formData.get(field) ?? "").trim();
    return text === "" ? null : parseMoney(text);
  };
  const valueCents = money("value");
  const maxDiscountCents = money("maxDiscount");
  const minOrderCents = money("minOrder") ?? 0;
  if (data.type === "fixed" && !valueCents) return { error: "Diga o valor do desconto." };
  if (data.type === "percent" && data.percent === "") return { error: "Diga o percentual do desconto." };

  try {
    await sql.begin(async (tx) => {
      const [coupon] = await tx<{ id: string }[]>`
        insert into coupons (code, description, type, value_cents, percent, max_discount_cents, paid_by, created_by_store_id,
                             expires_at, max_uses, max_uses_per_customer, min_order_cents, first_order_only, store_ids)
        values (${data.code}, ${`Cupom da ${membership.storeName}`}, ${data.type}::coupon_type,
                ${data.type === "fixed" ? valueCents : null}, ${data.type === "percent" ? data.percent : null},
                ${data.type === "percent" ? maxDiscountCents : null}, 'store', ${membership.storeId},
                ${data.expiresAt ? fromLocal(data.expiresAt, 24 * 60) : null}, ${data.maxUses === "" ? null : data.maxUses},
                ${data.maxUsesPerCustomer}, ${minOrderCents}, ${formData.get("firstOrderOnly") === "on"},
                array[${membership.storeId}]::uuid[])
        returning id`;
      await audit({ actorId: profile.id, action: "coupon.create", entityType: "coupon", entityId: coupon.id, storeId: membership.storeId, details: { code: data.code } }, tx);
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Já existe um cupom com esse código. Escolha outro." };
    throw error;
  }
  done();
  return { ok: true, message: `Cupom ${data.code} criado.` };
}

export async function toggleStoreCoupon(formData: FormData): Promise<void> {
  const { membership } = await owner();
  await sql`
    update coupons set active = not active
    where id = ${uuid.parse(formData.get("id"))} and created_by_store_id = ${membership.storeId}`;
  done();
}

// --------------------------------------------------------------- avaliações

export async function replyReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { membership } = await requireStoreMember(["owner", "attendant"]);
  const id = uuid.safeParse(formData.get("id"));
  const reply = z.string().trim().min(1, "Escreva a resposta.").max(500).safeParse(formData.get("reply"));
  if (!id.success) return { error: "Avaliação inválida." };
  if (!reply.success) return { error: reply.error.issues[0].message };

  await sql`
    update reviews set reply = ${reply.data}, replied_at = ${await now()}
    where id = ${id.data} and store_id = ${membership.storeId}`;
  done();
  return { ok: true, message: "Resposta publicada." };
}

/** Sinaliza uma avaliação para o admin olhar (ofensiva, não é sobre esta loja...). */
export async function reportReview(formData: FormData): Promise<void> {
  const { membership } = await requireStoreMember(["owner", "attendant"]);
  await sql`
    update reviews set reported_at = ${await now()}
    where id = ${uuid.parse(formData.get("id"))} and store_id = ${membership.storeId} and reported_at is null`;
  done();
}

// ------------------------------------------------------------------ faturas

/** Paga uma fatura mensal pelo app, com o mesmo provedor usado nos pedidos. */
export async function payInvoice(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Fatura inválida." };

  const at = await now();
  const provider = getPaymentProvider();
  const [invoice] = await sql<{ id: string; amount_cents: number }[]>`
    select id, amount_cents from invoices
    where id = ${id.data} and store_id = ${membership.storeId} and status in ('open', 'overdue')`;
  if (!invoice) return { error: "Esta fatura já foi paga." };

  const [row] = await sql<{ id: string }[]>`select gen_random_uuid() as id`;
  const created = await provider.createPayment({
    reference: row.id, amountCents: invoice.amount_cents, method: "pix",
    description: `Mensalidade Chegô - ${membership.storeName}`, expiresAt: new Date(at.getTime() + 30 * MINUTE_MS),
  });
  await sql`
    insert into payments (id, invoice_id, provider, provider_payment_id, method, status, amount_cents, pix_copy_paste, expires_at, raw_payload, created_at)
    values (${row.id}, ${invoice.id}, ${provider.name}, ${created.providerPaymentId}, 'pix', 'pending', ${invoice.amount_cents},
            ${created.pixCopyPaste}, ${new Date(at.getTime() + 30 * MINUTE_MS)}, ${sql.json(created.raw as never)}, ${at})`;

  // O banco de mentira aprova na hora, pelo mesmo webhook de um de verdade.
  const { rawBody, signature } = buildMockWebhook(created.providerPaymentId, "payment.approved");
  await handlePaymentWebhook(rawBody, signature);

  await audit({ actorId: profile.id, action: "invoice.pay", entityType: "invoice", entityId: invoice.id, storeId: membership.storeId });
  done();
  return { ok: true, message: "Fatura paga. Obrigado!" };
}
