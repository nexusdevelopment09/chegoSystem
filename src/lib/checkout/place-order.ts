import "server-only";
import { randomInt } from "node:crypto";
import type postgres from "postgres";
import type { CurrentProfile } from "@/lib/auth/session";
import { toSnapshot } from "@/lib/catalog/selection";
import { sql } from "@/lib/db";
import { MINUTE_MS } from "@/lib/time";
import { getPaymentProvider } from "@/lib/payments";
import type { CardData } from "@/lib/payments/types";
import { getSettings } from "@/lib/settings";
import { buildQuote, type CartInput } from "./quote";

export type PlaceOrderResult =
  | { ok: true; orderId: string; paymentId: string; providerPaymentId: string }
  | { ok: false; errors: string[] };

class Conflict extends Error {}

/**
 * Creates the order from a cart. Every price comes from the quote built on
 * the server; nothing the browser says about money is used. The order is
 * born "awaiting_payment": the store only sees it after the gateway confirms.
 */
export async function placeOrder(
  input: CartInput,
  profile: CurrentProfile,
  at: Date,
  card?: CardData,
): Promise<PlaceOrderResult> {
  const built = await buildQuote(input, profile, at, { mode: "place" });
  if ("fatal" in built) return { ok: false, errors: [built.fatal] };
  const { quote, internals } = built;
  if (!quote.ok) return { ok: false, errors: quote.errors };

  const settings = await getSettings();
  const expiresAt = new Date(at.getTime() + settings.pix_expiration_minutes * MINUTE_MS);
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  const { totals } = quote;

  try {
    return await sql.begin(async (tx): Promise<PlaceOrderResult> => {
      // Reserve the stock. Losing a race for the last unit cancels everything.
      for (const [productId, quantity] of quantities(input)) {
        const reserved = await tx`
          update products set stock_qty = case when track_stock then stock_qty - ${quantity} else stock_qty end
          where id = ${productId} and (not track_stock or stock_qty >= ${quantity})
          returning id`;
        if (reserved.length === 0) throw new Conflict("Um item do carrinho acabou de esgotar. Confira o carrinho.");
      }

      // "Indique e ganhe": the friend's code becomes a personal coupon of this customer.
      let couponId = internals.coupon?.id ?? null;
      if (internals.coupon && !couponId && internals.coupon.referrerId) {
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
          code, city_id, customer_id, store_id, status, fulfillment, customer_name, customer_phone,
          address_snapshot, neighborhood_id, scheduled_for, estimated_at,
          subtotal_cents, discount_cents, discount_paid_by, coupon_id, delivery_fee_cents, service_fee_cents,
          commission_rate, commission_cents, store_amount_cents, platform_amount_cents, total_cents,
          payment_method, age_confirmed, requires_age_check, missing_item_policy, notes, delivery_code,
          payment_expires_at, created_at
        ) values (
          ${code}, ${internals.cityId}, ${profile.id}, ${quote.store.id}, 'awaiting_payment', ${quote.fulfillment},
          ${profile.fullName}, ${profile.phone},
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
          ${expiresAt}, ${at}
        ) returning id`;

      for (const line of quote.lines) {
        const { product, groups } = internals.resolved.get(line.key)!;
        const [item] = await tx<{ id: string }[]>`
          insert into order_items (order_id, product_id, name, unit_price_cents, quantity, line_total_cents, notes, requires_age_check)
          values (${order.id}, ${product.id}, ${product.name}, ${line.unitPriceCents}, ${line.quantity},
                  ${line.lineTotalCents}, ${line.notes || null}, ${product.requiresAgeCheck})
          returning id`;

        // Copies of the choices and their prices: later menu edits never change this order.
        for (const [index, option] of toSnapshot(groups).entries()) {
          await tx`
            insert into order_item_options (order_item_id, option_id, group_name, option_name, price_mode, quantity, price_cents, sort_order)
            values (${item.id}, ${option.optionId}, ${option.groupName}, ${option.optionName}, ${option.mode}::option_price_mode,
                    ${option.quantity}, ${option.priceCents}, ${index})`;
        }
      }

      await tx`
        insert into order_status_history (order_id, status, changed_by, created_at)
        values (${order.id}, 'awaiting_payment', ${profile.id}, ${at})`;

      if (totals.discountCents > 0 && couponId) {
        await tx`
          insert into coupon_redemptions (coupon_id, order_id, customer_id, discount_cents, created_at)
          values (${couponId}, ${order.id}, ${profile.id}, ${totals.discountCents}, ${at})`;
      }

      // The cart was turned into an order: the saved copy is no longer needed.
      await tx`delete from carts where profile_id = ${profile.id}`;

      const payment = await createOrderPayment(tx, {
        orderId: order.id, code, storeId: quote.store.id, method: input.paymentMethod, expiresAt, at, card,
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

/** Asks the gateway for a payment (with the split) and records it as pending. */
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
