"use server";

import { z } from "zod";
import { selfSignupAccount } from "@/lib/auth/accounts";
import { getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { parseDocument } from "@/lib/documents";
import { toE164 } from "@/lib/format";
import { adminIds, notify } from "@/lib/notifications/notify";
import { sendOutbound } from "@/lib/notifications/outbound";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";

export type SignupState = { error?: string; ok?: boolean; message?: string };

const slugify = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const schema = z.object({
  storeName: z.string().trim().min(3, "Diga o nome da loja.").max(80),
  description: z.string().trim().max(300),
  categoryId: z.uuid("Escolha a categoria."),
  neighborhoodId: z.uuid("Escolha o bairro da loja."),
  street: z.string().trim().min(2, "Diga a rua da loja.").max(120),
  number: z.string().trim().max(20),
  ownerName: z.string().trim().min(3, "Diga o nome do responsável.").max(80),
  documentType: z.enum(["cpf", "cnpj"]),
});

/**
 * "Quero vender no Chegô": a loja se cadastra sozinha. Fica pendente,
 * invisível para os clientes, até o admin passar pelo checklist e
 * aprovar. Enquanto isso o dono já pode entrar e montar o cardápio.
 */
export async function requestStore(_previous: SignupState, formData: FormData): Promise<SignupState> {
  if (!(await rateLimit(`store-signup:${await clientIp()}`, 5, 3600))) return { error: TOO_MANY_ATTEMPTS };

  const parsed = schema.safeParse({
    storeName: formData.get("storeName"), description: formData.get("description") ?? "", categoryId: formData.get("categoryId"),
    neighborhoodId: formData.get("neighborhoodId"), street: formData.get("street"), number: formData.get("number") ?? "",
    ownerName: formData.get("ownerName"), documentType: formData.get("documentType"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const phone = toE164(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Telefone inválido. Use DDD + número." };
  const checked = parseDocument(data.documentType, formData.get("documentNumber"));
  if (!checked.ok) return { error: checked.error };
  const document = checked.digits;
  if (formData.get("accepted") !== "on") return { error: "Para continuar, aceite os Termos do Lojista." };

  const [place] = await sql<{ city_id: string }[]>`
    select n.city_id from neighborhoods n join cities c on c.id = n.city_id where n.id = ${data.neighborhoodId} and n.active and c.active`;
  const [category] = await sql`select id from categories where id = ${data.categoryId} and active`;
  if (!place || !category) return { error: "Escolha a categoria e o bairro da lista." };

  const [at, settings, signedIn] = await Promise.all([now(), getSettings(), getCurrentProfile()]);
  const result = await sql.begin(async (tx) => {
    const found = await selfSignupAccount(tx, {
      phone, fullName: data.ownerName, role: "merchant", cityId: place.city_id,
      password: String(formData.get("password") ?? ""), signedInId: signedIn?.id ?? null,
    });
    if ("error" in found) return { error: found.error };
    const owner = found.account;
    if (owner.role === "admin") return { error: "Use outro telefone para a loja." };
    if (!found.created) {
      await tx`update profiles set role = 'merchant', full_name = case when full_name = '' then ${data.ownerName} else full_name end where id = ${owner.id}`;
    }

    const [duplicate] = await tx`
      select 1 from stores where owner_id = ${owner.id} and lower(name) = lower(${data.storeName}) and status in ('pending', 'active', 'paused')`;
    if (duplicate) return { error: "Você já cadastrou uma loja com esse nome. A gente avisa quando ela for aprovada." };

    // O endereço no link é único: um número é acrescentado quando o nome já existe.
    const base = slugify(data.storeName) || "loja";
    const taken = await tx<{ slug: string }[]>`select slug from stores where slug = ${base} or slug like ${`${base}-%`}`;
    const slug = taken.length === 0 ? base : `${base}-${taken.length + 1}`;

    const [store] = await tx<{ id: string }[]>`
      insert into stores (city_id, category_id, owner_id, name, slug, description, street, number, neighborhood_id, status, created_at)
      values (${place.city_id}, ${data.categoryId}, ${owner.id}, ${data.storeName}, ${slug}, ${data.description}, ${data.street},
              ${data.number || "S/N"}, ${data.neighborhoodId}, 'pending', ${at})
      returning id`;
    await tx`
      insert into store_private (store_id, internal_phone, document_type, document_number, commission_rate)
      values (${store.id}, ${phone}, ${data.documentType}, ${document}, ${settings.default_commission_rate})`;
    await tx`insert into store_members (store_id, profile_id, role) values (${store.id}, ${owner.id}, 'owner')`;
    await tx`insert into store_status_events (store_id, kind, to_status, actor_id, created_at) values (${store.id}, 'cadastrada', 'pending', ${owner.id}, ${at})`;

    await notify({
      profileIds: await adminIds(tx), type: "store_signup", title: "Nova loja esperando aprovação",
      body: `${data.storeName} pediu para vender no Chegô.`, link: `/admin/lojas/${store.id}`, at,
    }, tx);
    return { storeId: store.id };
  });
  if ("error" in result) return { error: result.error };

  await sendOutbound({
    channel: "sms", recipient: phone,
    body: `Chegô: recebemos o cadastro da ${data.storeName}. Entre como lojista, com este telefone e a sua senha, para montar o cardápio enquanto analisamos.`,
  });
  return { ok: true, message: `Recebemos o cadastro da ${data.storeName}! Entre em "Sou lojista" com o seu telefone e a sua senha para montar o cardápio. A gente avisa quando a loja for aprovada.` };
}
