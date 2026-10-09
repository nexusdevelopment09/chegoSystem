"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { placeOrder } from "@/lib/checkout/place-order";
import { cartInputSchema } from "@/lib/checkout/quote";
import { now } from "@/lib/clock";
import { sql, withUser } from "@/lib/db";
import { handlePaymentWebhook } from "@/lib/payments/webhook";
import { buildMockWebhook, mockCardOutcome } from "@/lib/payments/mock";
import { rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";

const cardSchema = z.object({
  number: z.string().regex(/^[\d ]{13,23}$/, "Número do cartão inválido."),
  holder: z.string().trim().min(3, "Diga o nome que está no cartão.").max(60),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Validade no formato MM/AA."),
  cvv: z.string().regex(/^\d{3,4}$/, "Código de segurança inválido."),
});

export type SubmitResponse = { ok: true; orderId: string } | { ok: false; errors: string[] };

/** Places the order. Prices come from the server; the payload only says what was chosen. */
export async function submitOrder(payload: unknown, cardPayload?: unknown): Promise<SubmitResponse> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, errors: ["Entre na sua conta para fazer o pedido."] };
  if (!(await rateLimit(`checkout:${profile.id}`, 10, 600))) return { ok: false, errors: [TOO_MANY_ATTEMPTS] };

  const parsed = cartInputSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, errors: ["Seu carrinho está com um problema. Esvazie e monte de novo."] };

  let card: z.infer<typeof cardSchema> | undefined;
  if (parsed.data.paymentMethod === "card") {
    const cardParsed = cardSchema.safeParse(cardPayload);
    if (!cardParsed.success) return { ok: false, errors: [cardParsed.error.issues[0].message] };
    card = cardParsed.data;
  }

  const result = await placeOrder(parsed.data, profile, await now(), card);
  if (!result.ok) return result;

  // The pretend gateway answers a card right away, through the same webhook a real one uses.
  if (card) {
    const outcome = mockCardOutcome(card.number);
    const { rawBody, signature } = buildMockWebhook(result.providerPaymentId, outcome === "approved" ? "payment.approved" : "payment.declined");
    await handlePaymentWebhook(rawBody, signature);
  }
  return { ok: true, orderId: result.orderId };
}

// --------------------------------------------------------------- addresses

const addressSchema = z.object({
  street: z.string().trim().min(2, "Diga o nome da rua.").max(120),
  number: z.string().trim().max(20).default(""),
  neighborhoodId: z.uuid("Escolha o bairro ou a comunidade."),
  reference: z.string().trim().max(200).default(""),
  complement: z.string().trim().max(100).default(""),
});

export type AddressResponse = { ok: true; addressId: string } | { ok: false; error: string };

export async function saveAddress(payload: unknown): Promise<AddressResponse> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Entre na sua conta para salvar o endereço." };

  const parsed = addressSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;

  const [hood] = await sql<{ is_rural: boolean }[]>`select is_rural from neighborhoods where id = ${data.neighborhoodId} and active`;
  if (!hood) return { ok: false, error: "Escolha o bairro ou a comunidade." };
  // In the countryside there is often no street number: the landmark is what finds the house.
  if (hood.is_rural && !data.reference) {
    return { ok: false, error: "Na zona rural, diga um ponto de referência para o entregador achar." };
  }

  const [address] = await withUser(profile.id, async (tx) => {
    await tx`update addresses set is_default = false where profile_id = ${profile.id}`;
    return tx<{ id: string }[]>`
      insert into addresses (profile_id, label, street, number, neighborhood_id, reference, complement, is_default)
      values (${profile.id}, 'Casa', ${data.street}, ${data.number || "S/N"}, ${data.neighborhoodId},
              ${data.reference || null}, ${data.complement || null}, true)
      returning id`;
  });
  return { ok: true, addressId: address.id };
}
