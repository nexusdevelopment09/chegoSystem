// Coupon rules, with a clear message for every refusal. Pure functions.
import type { DiscountPayer } from "../orders/totals.ts";

export type CouponRules = {
  code: string;
  type: "fixed" | "percent" | "free_delivery";
  valueCents: number | null;
  percent: number | null;
  maxDiscountCents: number | null;
  paidBy: DiscountPayer;
  ownerProfileId: string | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usesCount: number;
  maxUsesPerCustomer: number;
  minOrderCents: number;
  firstOrderOnly: boolean;
  storeIds: string[];
  categoryIds: string[];
  cityIds: string[];
  active: boolean;
};

export type CouponContext = {
  now: Date;
  customerId: string;
  /** Orders the customer already paid for in the app. */
  customerPaidOrders: number;
  /** Times this customer already used this coupon. */
  customerUses: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  storeId: string;
  categoryId: string;
  cityId: string;
};

export type CouponResult =
  | { ok: true; productDiscountCents: number; deliveryDiscountCents: number; paidBy: DiscountPayer }
  | { ok: false; message: string };

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

export function validateCoupon(coupon: CouponRules | null, context: CouponContext): CouponResult {
  const refuse = (message: string): CouponResult => ({ ok: false, message });

  if (!coupon || !coupon.active) return refuse("Cupom não encontrado");
  if (coupon.ownerProfileId && coupon.ownerProfileId !== context.customerId) return refuse("Cupom não encontrado");
  if (coupon.startsAt && coupon.startsAt > context.now) return refuse("Este cupom ainda não começou a valer");
  if (coupon.expiresAt && coupon.expiresAt <= context.now) return refuse("Cupom expirado");
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) return refuse("Este cupom já esgotou");
  if (context.customerUses >= coupon.maxUsesPerCustomer) return refuse("Você já usou este cupom");
  if (coupon.firstOrderOnly && context.customerPaidOrders > 0) return refuse("Este cupom é só para a primeira compra");
  if (coupon.storeIds.length > 0 && !coupon.storeIds.includes(context.storeId)) return refuse("Este cupom não vale para esta loja");
  if (coupon.categoryIds.length > 0 && !coupon.categoryIds.includes(context.categoryId)) return refuse("Este cupom não vale para esta categoria");
  if (coupon.cityIds.length > 0 && !coupon.cityIds.includes(context.cityId)) return refuse("Este cupom não vale para esta cidade");
  if (context.subtotalCents < coupon.minOrderCents) {
    return refuse(`Pedido mínimo de ${brl(coupon.minOrderCents)} para este cupom`);
  }

  if (coupon.type === "free_delivery") {
    if (context.deliveryFeeCents === 0) return refuse("Este cupom é de frete grátis, e este pedido não tem taxa de entrega");
    return { ok: true, productDiscountCents: 0, deliveryDiscountCents: context.deliveryFeeCents, paidBy: coupon.paidBy };
  }

  const raw = coupon.type === "fixed"
    ? coupon.valueCents ?? 0
    : Math.round((context.subtotalCents * (coupon.percent ?? 0)) / 100);
  const capped = Math.min(raw, coupon.maxDiscountCents ?? Infinity, context.subtotalCents);
  return { ok: true, productDiscountCents: capped, deliveryDiscountCents: 0, paidBy: coupon.paidBy };
}
