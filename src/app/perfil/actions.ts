"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { saveAddress } from "@/app/carrinho/actions";
import { audit } from "@/lib/audit";
import { destroyAllSessions, getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql, withUser } from "@/lib/db";
import { IN_PROGRESS } from "@/lib/orders/status";

export type ActionState = { error?: string; ok?: boolean; message?: string };

export async function signOutEverywhere() {
  const profile = await getCurrentProfile();
  if (profile) await destroyAllSessions(profile.id);
  redirect("/entrar");
}

const profileSchema = z.object({
  fullName: z.string().trim().min(3, "Diga seu nome completo.").max(80),
  email: z.union([z.email("E-mail inválido."), z.literal("")]),
  birthDate: z.union([z.iso.date(), z.literal("")]),
});

export async function updateProfile(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"), email: String(formData.get("email") ?? "").trim().toLowerCase(), birthDate: formData.get("birthDate") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.birthDate && parsed.data.birthDate > new Date().toISOString().slice(0, 10)) return { error: "Data de nascimento inválida." };

  try {
    // Name, birth date and the promo preference are the columns a user may change directly;
    // the e-mail is unique across accounts, so it goes through the owner connection.
    await sql`
      update profiles set full_name = ${parsed.data.fullName}, email = ${parsed.data.email || null},
        birth_date = ${parsed.data.birthDate || null}, promo_notifications = ${formData.get("promo") === "on"}
      where id = ${profile.id}`;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Este e-mail já está em outra conta." };
    throw error;
  }
  revalidatePath("/perfil");
  return { ok: true, message: "Dados salvos." };
}

export async function addAddress(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await saveAddress({
    street: formData.get("street"), number: formData.get("number"), neighborhoodId: formData.get("neighborhoodId"),
    reference: formData.get("reference"), complement: formData.get("complement"),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/perfil");
  return { ok: true, message: "Endereço salvo." };
}

export async function removeAddress(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  const id = z.uuid().parse(formData.get("id"));
  // As the user: Row Level Security only lets them touch their own addresses.
  await withUser(profile.id, (tx) => tx`update addresses set deleted_at = now(), is_default = false where id = ${id}`);
  revalidatePath("/perfil");
}

export async function makeDefaultAddress(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  const id = z.uuid().parse(formData.get("id"));
  await withUser(profile.id, async (tx) => {
    await tx`update addresses set is_default = false where profile_id = ${profile.id}`;
    await tx`update addresses set is_default = true where id = ${id} and deleted_at is null`;
  });
  revalidatePath("/perfil");
}

export async function markNotificationsRead(): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;
  const at = await now();
  await withUser(profile.id, (tx) => tx`update notifications set read_at = ${at} where read_at is null`);
  revalidatePath("/notificacoes");
}

/**
 * Deletes the account (LGPD). Orders are kept for the bookkeeping, but
 * everything personal is removed or anonymised, and the person is signed out.
 */
export async function deleteAccount(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "EXCLUIR") {
    return { error: "Para confirmar, escreva EXCLUIR." };
  }
  if (profile.role !== "customer") {
    return { error: "Contas de loja e da equipe são encerradas pelo suporte. Fale com a gente." };
  }

  const [active] = await sql`
    select 1 from orders where customer_id = ${profile.id} and status::text = any(${["awaiting_payment", ...IN_PROGRESS]}) limit 1`;
  if (active) return { error: "Você tem pedido em andamento. Espere ele terminar para excluir a conta." };

  await sql.begin(async (tx) => {
    await tx`delete from addresses where profile_id = ${profile.id}`;
    await tx`delete from carts where profile_id = ${profile.id}`;
    await tx`delete from favorites where profile_id = ${profile.id}`;
    await tx`delete from push_subscriptions where profile_id = ${profile.id}`;
    await tx`delete from notifications where profile_id = ${profile.id}`;
    await tx`delete from sessions where profile_id = ${profile.id}`;
    await tx`
      update orders set customer_name = 'Cliente removido', customer_phone = null, address_snapshot = null, notes = null
      where customer_id = ${profile.id}`;
    await tx`update reviews set comment = null where customer_id = ${profile.id}`;
    await tx`delete from order_messages where sender_id = ${profile.id}`;
    await tx`delete from blocked_message_attempts where sender_id = ${profile.id}`;
    await tx`update ticket_messages set body = '[mensagem removida]', attachment_url = null where sender_id = ${profile.id}`;
    await tx`
      update profiles set full_name = 'Cliente removido', phone = null, email = null, password_hash = null,
        birth_date = null, referral_code = null, deleted_at = now()
      where id = ${profile.id}`;
    await audit({ actorId: null, action: "account.delete", entityType: "profile", entityId: profile.id }, tx);
  });
  redirect("/entrar");
}
