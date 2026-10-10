import type { Cart } from "./local";

export type CheckoutChoices = {
  fulfillment?: "delivery" | "pickup";
  addressId?: string | null;
  scheduledFor?: string | null;
  couponCode?: string | null;
  ageConfirmed?: boolean;
  missingItemPolicy?: "call" | "substitute" | "remove" | null;
  paymentMethod?: "pix" | "card";
};

/** O que é enviado ao servidor sobre uma sacola. O preço mostrado só vai como "o que eu vi". */
export function toCartPayload(cart: Cart, choices: CheckoutChoices = {}) {
  return {
    storeId: cart.storeId,
    notes: cart.notes,
    items: cart.items.map((item) => ({
      key: item.key, productId: item.productId, quantity: item.quantity, notes: item.notes,
      picks: item.picks, expectedUnitPriceCents: item.unitPriceCents,
    })),
    ...choices,
  };
}
