"use server";

import { z } from "zod";
import { selfSignupAccount } from "@/lib/auth/accounts";
import { getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { parseDocument } from "@/lib/documents";
import { toE164 } from "@/lib/format";
import { acceptPendingLegalDocuments } from "@/lib/legal";
import { adminIds, notify } from "@/lib/notifications/notify";
import { sendOutbound } from "@/lib/notifications/outbound";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";

export type SignupState = { error?: string; ok?: boolean; message?: string };

const schema = z.object({
  fullName: z.string().trim().min(3, "Diga o seu nome completo.").max(80),
  cityId: z.uuid("Escolha a cidade."),
  vehicle: z.enum(["motorcycle", "bicycle", "car", "on_foot"], "Escolha como você faz as entregas."),
  plate: z.string().trim().toUpperCase().max(8),
});

/**
 * "Quero entregar pelo Chegô": o entregador parceiro se cadastra sozinho.
 * Fica em análise, sem receber entregas, até o admin aprovar.
 */
export async function requestCourier(_previous: SignupState, formData: FormData): Promise<SignupState> {
  if (!(await rateLimit(`courier-signup:${await clientIp()}`, 5, 3600))) return { error: TOO_MANY_ATTEMPTS };

  const parsed = schema.safeParse({
    fullName: formData.get("fullName"), cityId: formData.get("cityId"), vehicle: formData.get("vehicle"), plate: formData.get("plate") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const phone = toE164(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Telefone inválido. Use DDD + número." };
  const document = parseDocument(formData.get("documentType"), formData.get("documentNumber"));
  if (!document.ok) return { error: document.error };
  if ((data.vehicle === "motorcycle" || data.vehicle === "car") && data.plate.length < 7) return { error: "Diga a placa do veículo." };
  if (formData.get("accepted") !== "on") return { error: "Para continuar, aceite os Termos de Uso." };

  const [city] = await sql`select id from cities where id = ${data.cityId} and active`;
  if (!city) return { error: "Escolha a cidade da lista." };

  const [at, signedIn] = await Promise.all([now(), getCurrentProfile()]);
  const result = await sql.begin(async (tx) => {
    const found = await selfSignupAccount(tx, {
      phone, fullName: data.fullName, role: "courier", cityId: data.cityId,
      password: String(formData.get("password") ?? ""), signedInId: signedIn?.id ?? null,
    });
    if ("error" in found) return { error: found.error };
    const person = found.account;
    // Lojista e admin usam o telefone para outra coisa; cada papel tem o seu.
    if (person.role !== "customer" && person.role !== "courier") return { error: "Esse telefone já é usado por uma loja. Use outro para entregar." };
    const [existing] = await tx`select 1 from couriers where profile_id = ${person.id}`;
    if (existing) return { error: "Você já tem um cadastro de entregador. Entre com o seu telefone e a sua senha para acompanhar." };

    if (!found.created) {
      await tx`update profiles set role = 'courier', full_name = case when full_name = '' then ${data.fullName} else full_name end, city_id = ${data.cityId} where id = ${person.id}`;
    }
    await tx`
      insert into couriers (profile_id, kind, status, city_id, document_type, document_number, vehicle, plate, created_at)
      values (${person.id}, 'partner', 'pending', ${data.cityId}, ${document.type}, ${document.digits}, ${data.vehicle}, ${data.plate || null}, ${at})`;

    await notify({
      profileIds: await adminIds(tx), type: "courier_signup", title: "Novo entregador esperando aprovação",
      body: `${data.fullName} pediu para entregar pelo Chegô.`, link: "/admin/entregadores?situacao=pending", at,
    }, tx);
    return { profileId: person.id };
  });
  if ("error" in result) return { error: result.error };
  // Os termos foram aceitos neste formulário: o aceite fica gravado com data e versão.
  await acceptPendingLegalDocuments(result.profileId, "courier");

  await sendOutbound({ channel: "sms", recipient: phone, body: "Chegô: recebemos o seu cadastro de entregador. A gente avisa quando for aprovado." });
  return { ok: true, message: "Recebemos o seu cadastro! Entre em \"Sou entregador\" com o seu telefone e a sua senha para acompanhar. A gente avisa quando você puder começar." };
}
