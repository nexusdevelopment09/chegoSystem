import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import type postgres from "postgres";
import type { CurrentProfile } from "@/lib/auth/session";
import { toSnapshot } from "@/lib/catalog/selection";
import { sql } from "@/lib/db";
import { toE164 } from "@/lib/format";
import { hashGuestToken } from "@/lib/orders/guest";
import { MINUTE_MS } from "@/lib/time";
import { getPaymentProvider } from "@/lib/payments";
import { paymentCollection } from "@/lib/payments/collection";
import { transitionOrder } from "@/lib/orders/transitions";
import type { CardData } from "@/lib/payments/types";
import { getSettings } from "@/lib/settings";
import { buildQuote, type CartInput } from "./quote";
import { recordOrderSales } from "@/lib/inventory/stock";

export type PlaceOrderResult =
  /** Pagando direto à loja não há pagamento no app: paymentId e providerPaymentId vêm nulos. */
  | { ok: true; orderId: string; paymentId: string | null; providerPaymentId: string | null; guestToken?: string }
  | { ok: false; errors: string[] };

class Conflict extends Error {}

/**
 * Cria o pedido a partir de uma sacola. Todo preço vem da cotação montada no
 * servidor; nada do que o navegador diz sobre dinheiro é usado.
 *
 * Pagando direto à loja (padrão), o pedido vai para a loja na mesma transação: o
 * cliente paga a ela na entrega ou por Pix. Pagando pelo app, nasce "awaiting_payment"
 * e a loja só o vê depois que o gateway confirma.
 */
export async function placeOrder(
  input: CartInput,
  profile: CurrentProfile | null,
  at: Date,
  card?: CardData,
): Promise<PlaceOrderResult> {
  // Sem conta: nome e telefone vêm do pedido, e o link de acompanhamento leva um token
  // (só o hash fica no banco). Cupom, chat e avaliação continuam pedindo conta.
  const guestToken = profile ? null : randomBytes(24).toString("base64url");
  const buyer = profile
    ? { id: profile.id as string | null, name: profile.fullName, phone: profile.phone }
    : { id: null, name: input.guest?.name ?? "", phone: toE164(input.guest?.phone ?? "") };
  const built = await buildQuote(input, profile, at, { mode: "place" });
  if ("fatal" in built) return { ok: false, errors: [built.fatal] };
  const { quote, internals } = built;
  if (!quote.ok) return { ok: false, errors: quote.errors };

  const settings = await getSettings();
  const direct = paymentCollection() === "store";
  const expiresAt = direct ? null : new Date(at.getTime() + settings.pix_expiration_minutes * MINUTE_MS);
  const cashChangeFor = direct && input.paymentMethod === "cash" ? input.cashChangeForCents ?? null : null;
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  const { totals } = quote;

  try {
    return await sql.begin(async (tx): Promise<PlaceOrderResult> => {
      // Reserva o estoque. Perder a corrida pela última unidade cancela tudo.
      for (const [productId, quantity] of quantities(input)) {
        const reserved = await tx`
          update products set stock_qty = case when track_stock then stock_qty - ${quantity} else stock_qty end
          where id = ${productId} and (not track_stock or stock_qty >= ${quantity})
          returning id`;
        if (reserved.length === 0) throw new Conflict("Um item do carrinho acabou de esgotar. Confira o carrinho.");
      }

      // "Indique e ganhe": o código do amigo vira um cupom pessoal deste cliente.
      let couponId = internals.coupon?.id ?? null;
      if (internals.coupon && !couponId && internals.coupon.referrerId && profile) {
        const [created] = await tx<{ id: string }[]>`
          insert into coupons (code, description, type, value_cents, paid_by, owner_profile_id, max_uses, first_order_only)
          values (${`INDICADO-${randomInt(100000, 999999)}`}, 'Desconto por indicação', 'fixed', ${totals.discountCents},
                  'platform', ${profile.id}, 1, true)
          returning id`;
        couponId = created.id;
        await tx`
          insert into referrals (referrer_id, referred_id, referred_coupon_id)
          values (${internals.coupon.referrerId}, ${profile.id}, ${couponId})`;
      }
      if (couponId) {
        const used = await tx`
          update coupons set uses_count = uses_count + 1
          where id = ${couponId} and (max_uses is null or uses_count < max_uses)
          returning id`;
        if (used.length === 0) throw new Conflict("Este cupom já esgotou");
      }

      const [city] = await tx<{ prefix: string; number: number }[]>`
        update cities set next_order_number = next_order_number + 1
        where id = ${internals.cityId}
        returning order_code_prefix as prefix, next_order_number - 1 as number`;
      const code = `${city.prefix}-${String(city.number).padStart(4, "0")}`;

      const address = internals.address;
      const [order] = await tx<{ id: string }[]>`
        insert into orders (
          code, city_id, customer_id, guest_token_hash, store_id, status, fulfillment, customer_name, customer_phone,
          address_snapshot, neighborhood_id, scheduled_for, estimated_at,
          subtotal_cents, discount_cents, discount_paid_by, coupon_id, delivery_fee_cents, service_fee_cents,
          commission_rate, commission_cents, store_amount_cents, platform_amount_cents, total_cents,
          payment_method, age_confirmed, requires_age_check, missing_item_policy, notes, delivery_code,
          payment_expires_at, created_at, delivery_provider, courier_fee_cents, payment_collection, cash_change_for_cents
        ) values (
          ${code}, ${internals.cityId}, ${buyer.id}, ${guestToken ? hashGuestToken(guestToken) : null}, ${quote.store.id}, 'awaiting_payment', ${quote.fulfillment},
          ${buyer.name}, ${buyer.phone},
          ${quote.fulfillment === "delivery" && address
            ? tx.json({
                street: address.street, number: address.number, neighborhood: address.neighborhood_name,
                reference: address.reference, complement: address.complement,
                city: `${address.city_name} - ${address.state}`, rural: address.is_rural,
              })
            : null},
          ${internals.neighborhoodId}, ${scheduledFor},
          ${scheduledFor ?? new Date(at.getTime() + quote.estimateMinutes * MINUTE_MS)},
          ${totals.subtotalCents}, ${totals.discountCents},
          ${totals.discountCents > 0 ? internals.coupon!.paidBy : null}, ${totals.discountCents > 0 ? couponId : null},
          ${totals.deliveryFeeCents}, ${totals.serviceFeeCents}, ${internals.commissionRate}, ${totals.commissionCents},
          ${totals.storeAmountCents}, ${totals.platformAmountCents}, ${totals.totalCents},
          ${input.paymentMethod}, ${quote.requiresAgeCheck && input.ageConfirmed}, ${quote.requiresAgeCheck},
          ${quote.store.isMarket ? input.missingItemPolicy ?? null : null}, ${input.notes || null},
          ${quote.fulfillment === "delivery" ? String(randomInt(0, 10000)).padStart(4, "0") : null},
          ${expiresAt}, ${at}, ${internals.deliveryProvider}::delivery_provider, ${internals.courierFeeCents},
          ${direct ? "store" : "app"}::payment_collection, ${cashChangeFor}
        ) returning id`;

      for (const line of quote.lines) {
        const { product, groups } = internals.resolved.get(line.key)!;
        const [item] = await tx<{ id: string }[]>`
          insert into order_items (order_id, product_id, name, unit_price_cents, quantity, line_total_cents, notes, requires_age_check, weight_step_grams)
          values (${order.id}, ${product.id}, ${product.name}, ${line.unitPriceCents}, ${line.quantity},
                  ${line.lineTotalCents}, ${line.notes || null}, ${product.requiresAgeCheck}, ${product.weightStepGrams})
          returning id`;

        // Cópias das escolhas e dos preços: mudanças futuras no cardápio nunca alteram este pedido.
        for (const [index, option] of toSnapshot(groups).entries()) {
          await tx`
            insert into order_item_options (order_item_id, option_id, group_name, option_name, price_mode, quantity, price_cents, sort_order)
            values (${item.id}, ${option.optionId}, ${option.groupName}, ${option.optionName}, ${option.mode}::option_price_mode,
                    ${option.quantity}, ${option.priceCents}, ${index})`;
        }
      }

      await tx`
        insert into order_status_history (order_id, status, changed_by, created_at)
        values (${order.id}, 'awaiting_payment', ${buyer.id}, ${at})`;

      if (totals.discountCents > 0 && couponId) {
        await tx`
          insert into coupon_redemptions (coupon_id, order_id, customer_id, discount_cents, created_at)
          values (${couponId}, ${order.id}, ${buyer.id}, ${totals.discountCents}, ${at})`;
      }

      // Baixa no controle de estoque (itens ligados aos produtos), junto com a reserva acima.
      await recordOrderSales(tx, order.id);

      // A sacola virou pedido: a cópia salva não é mais necessária.
      if (profile) await tx`delete from carts where profile_id = ${profile.id}`;

      if (direct) {
        // Direto à loja: o pedido já vai para ela, como um pedido pago vai no outro modo.
        await transitionOrder(tx, { orderId: order.id, to: "paid", actor: "system", actorId: null, at });
        return { ok: true, orderId: order.id, paymentId: null, providerPaymentId: null, ...(guestToken ? { guestToken } : {}) };
      }

      if (input.paymentMethod === "cash") throw new Conflict("Essa forma de pagamento não está disponível para este pedido.");
      const payment = await createOrderPayment(tx, {
        orderId: order.id, code, storeId: quote.store.id, method: input.paymentMethod, expiresAt: expiresAt!, at, card,
        totalCents: totals.totalCents, storeAmountCents: totals.storeAmountCents, platformAmountCents: totals.platformAmountCents,
      });
      return { ok: true, orderId: order.id, ...payment };
    }) as PlaceOrderResult;
  } catch (error) {
    if (error instanceof Conflict) return { ok: false, errors: [error.message] };
    throw error;
  }
}

function quantities(input: CartInput): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of input.items) result.set(item.productId, (result.get(item.productId) ?? 0) + item.quantity);
  return result;
}

type Tx = postgres.TransactionSql;

/** Pede um pagamento ao gateway (com a divisão) e o grava como pendente. */
export async function createOrderPayment(
  tx: Tx,
  input: {
    orderId: string; code: string; storeId: string; method: "pix" | "card"; expiresAt: Date; at: Date; card?: CardData;
    totalCents: number; storeAmountCents: number; platformAmountCents: number;
  },
): Promise<{ paymentId: string; providerPaymentId: string }> {
  const provider = getPaymentProvider();
  const [recipient] = await tx<{ payment_recipient_id: string | null }[]>`
    select payment_recipient_id from store_private where store_id = ${input.storeId}`;

  const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
  const created = await provider.createPayment({
    reference: row.id, amountCents: input.totalCents, method: input.method,
    description: `Pedido ${input.code} no Chegô`, expiresAt: input.expiresAt, card: input.card,
    split: {
      storeRecipientId: recipient?.payment_recipient_id ?? null,
      storeAmountCents: input.storeAmountCents, platformAmountCents: input.platformAmountCents,
    },
  });

  await tx`
    insert into payments (id, order_id, provider, provider_payment_id, method, status, amount_cents, pix_copy_paste, expires_at, raw_payload, created_at)
    values (${row.id}, ${input.orderId}, ${provider.name}, ${created.providerPaymentId}, ${input.method}, 'pending',
            ${input.totalCents}, ${created.pixCopyPaste}, ${input.expiresAt}, ${tx.json(created.raw as never)}, ${input.at})`;

  return { paymentId: row.id, providerPaymentId: created.providerPaymentId };
}
