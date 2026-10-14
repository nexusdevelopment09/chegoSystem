"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { invitedAccount, temporaryPasswordNote } from "@/lib/auth/accounts";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { OFFER_STATUSES } from "@/lib/couriers";
import { sql } from "@/lib/db";
import { parseDocument } from "@/lib/documents";
import { formatCents, toE164 } from "@/lib/format";
import { notify } from "@/lib/notifications/notify";

// Gestão da rede de entregadores pelo admin. Tudo fica no log de auditoria.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const admin = () => requireRole("admin");
const done = () => revalidatePath("/admin", "layout");

/** Aprova um entregador em análise: ele passa a poder ficar disponível e pegar entregas. */
export async function approveCourier(formData: FormData): Promise<void> {
  const profile = await admin();
  const id = uuid.parse(formData.get("id"));
  const at = await now();
  await sql.begin(async (tx) => {
    const approved = await tx`
      update couriers set status = 'active', approved_at = ${at}, blocked_reason = null
      where profile_id = ${id} and status = 'pending' returning profile_id`;
    if (approved.length === 0) return;
    await audit({ actorId: profile.id, action: "courier.approve", entityType: "courier", entityId: id }, tx);
    await notify({
      profileIds: [id], type: "courier_approved", title: "Cadastro aprovado!",
      body: "Você já pode ficar disponível e pegar entregas pelo Chegô.", link: "/entregador", channels: ["sms", "push"], at,
    }, tx);
  });
  done();
}

/** Bloqueia (com motivo) ou desbloqueia um entregador. Bloqueado, ele não vê nem pega entregas. */
export async function setCourierBlocked(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const id = uuid.safeParse(formData.get("id"));
  const block = formData.get("block") === "1";
  const reason = z.string().trim().max(300).parse(formData.get("reason") ?? "");
  if (!id.success) return { error: "Entregador inválido." };
  if (block && reason.length < 3) return { error: "Para bloquear, escreva o motivo." };

  await sql.begin(async (tx) => {
    await tx`
      update couriers set status = ${block ? "blocked" : "active"}::courier_status, blocked_reason = ${block ? reason : null}, available = false
      where profile_id = ${id.data}`;
    // As entregas que ele pegou e ainda não retirou voltam para a fila.
    if (block) await tx`update orders set courier_id = null, courier_assigned_at = null where courier_id = ${id.data} and status::text = any(${OFFER_STATUSES})`;
    await audit({ actorId: profile.id, action: block ? "courier.block" : "courier.unblock", entityType: "courier", entityId: id.data, details: { reason } }, tx);
  });
  done();
  return { ok: true, message: block ? "Entregador bloqueado." : "Entregador desbloqueado." };
}

/** Muda o tipo: entregador do próprio Chegô ou parceiro autônomo. */
export async function setCourierKind(formData: FormData): Promise<void> {
  const profile = await admin();
  const id = uuid.parse(formData.get("id"));
  const kind = z.enum(["platform", "partner"]).parse(formData.get("kind"));
  await sql.begin(async (tx) => {
    await tx`update couriers set kind = ${kind}::courier_kind where profile_id = ${id}`;
    await audit({ actorId: profile.id, action: "courier.kind", entityType: "courier", entityId: id, details: { kind } }, tx);
  });
  done();
}

/** Cadastra um entregador do próprio Chegô, já aprovado. */
export async function createPlatformCourier(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const parsed = z.object({
    fullName: z.string().trim().min(3, "Diga o nome completo.").max(80),
    cityId: z.uuid("Escolha a cidade."),
    vehicle: z.enum(["motorcycle", "bicycle", "car", "on_foot"]),
    plate: z.string().trim().toUpperCase().max(8),
  }).safeParse({ fullName: formData.get("fullName"), cityId: formData.get("cityId"), vehicle: formData.get("vehicle"), plate: formData.get("plate") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const phone = toE164(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Telefone inválido. Use DDD + número." };
  const document = parseDocument(formData.get("documentType"), formData.get("documentNumber"));
  if (!document.ok) return { error: document.error };

  const at = await now();
  const result = await sql.begin(async (tx) => {
    const [taken] = await tx<{ role: string }[]>`select role from profiles where phone = ${phone} and deleted_at is null`;
    if (taken && taken.role !== "customer" && taken.role !== "courier") return { error: "Esse telefone já é de uma loja ou do admin." };
    const { account: person, password } = await invitedAccount(tx, { phone, fullName: data.fullName, role: "courier", cityId: data.cityId });
    const [existing] = await tx`select 1 from couriers where profile_id = ${person.id}`;
    if (existing) return { error: "Esse telefone já tem cadastro de entregador." };
    await tx`update profiles set role = 'courier', city_id = ${data.cityId} where id = ${person.id}`;

    await tx`
      insert into couriers (profile_id, kind, status, city_id, document_type, document_number, vehicle, plate, approved_at, created_at)
      values (${person.id}, 'platform', 'active', ${data.cityId}, ${document.type}, ${document.digits}, ${data.vehicle}, ${data.plate || null}, ${at}, ${at})`;
    await audit({ actorId: profile.id, action: "courier.create", entityType: "courier", entityId: person.id, details: { kind: "platform" } }, tx);
    return { password };
  });
  if ("error" in result) return { error: result.error };
  done();
  return { ok: true, message: `${data.fullName} cadastrado e já pode pegar entregas.${temporaryPasswordNote(result.password)}` };
}

/** Marca como repassado tudo o que o entregador tem a receber. O pagamento em si é feito fora do sistema (Pix). */
export async function payCourier(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Entregador inválido." };

  const at = await now();
  const total = await sql.begin(async (tx) => {
    const paid = await tx<{ amount_cents: number }[]>`
      update courier_earnings set paid_at = ${at}, paid_by = ${profile.id}
      where courier_id = ${id.data} and paid_at is null returning amount_cents`;
    const cents = paid.reduce((sum, row) => sum + row.amount_cents, 0);
    if (cents === 0) return 0;
    await tx`
      insert into ledger_entries (account, courier_id, direction, amount_cents, reason, created_at)
      values ('courier', ${id.data}, 'debit', ${cents}, 'payout', ${at})`;
    await audit({ actorId: profile.id, action: "courier.payout", entityType: "courier", entityId: id.data, details: { cents, deliveries: paid.length } }, tx);
    await notify({
      profileIds: [id.data], type: "courier_payout", title: "Repasse feito",
      body: `O Chegô repassou ${formatCents(cents)} das suas entregas.`, link: "/entregador", channels: ["push"], at,
    }, tx);
    return cents;
  });
  if (total === 0) return { error: "Este entregador não tem nada a receber." };
  done();
  return { ok: true, message: `Repasse de ${formatCents(total)} registrado.` };
}

/** Coloca um entregador da rede em uma entrega que está sem ninguém (ou troca o que estava). */
export async function assignCourier(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await admin();
  const orderId = uuid.safeParse(formData.get("orderId"));
  const courierId = uuid.safeParse(formData.get("courierId"));
  if (!orderId.success || !courierId.success) return { error: "Escolha o entregador." };

  const at = await now();
  const result = await sql.begin(async (tx) => {
    const [courier] = await tx`select 1 from couriers where profile_id = ${courierId.data} and status = 'active'`;
    if (!courier) return { error: "Esse entregador não está aprovado." };
    const [order] = await tx<{ code: string }[]>`
      update orders set courier_id = ${courierId.data}, courier_assigned_at = ${at}
      where id = ${orderId.data} and delivery_provider = 'platform' and fulfillment = 'delivery' and status::text = any(${OFFER_STATUSES})
      returning code`;
    if (!order) return { error: "Só dá para trocar o entregador antes de o pedido sair da loja." };
    await audit({ actorId: profile.id, action: "order.assign_courier", entityType: "order", entityId: orderId.data, details: { courierId: courierId.data } }, tx);
    await notify({
      profileIds: [courierId.data], type: "delivery_assigned", title: "Nova entrega para você",
      body: `O Chegô colocou o pedido ${order.code} com você.`, link: "/entregador", orderId: orderId.data, channels: ["push"], at,
    }, tx);
    return { ok: true };
  });
  if ("error" in result) return { error: result.error };
  done();
  return { ok: true, message: "Entregador definido." };
}
