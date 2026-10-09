import { describe, expect, it } from "vitest";
import { validateCoupon, type CouponContext, type CouponRules } from "./validate";

const now = new Date("2026-10-09T20:00:00-03:00");
const coupon = (extra: Partial<CouponRules> = {}): CouponRules => ({
  code: "TESTE", type: "fixed", valueCents: 1000, percent: null, maxDiscountCents: null, paidBy: "platform",
  ownerProfileId: null, startsAt: null, expiresAt: null, maxUses: null, usesCount: 0, maxUsesPerCustomer: 1,
  minOrderCents: 0, firstOrderOnly: false, storeIds: [], categoryIds: [], cityIds: [], active: true, ...extra,
});
const context = (extra: Partial<CouponContext> = {}): CouponContext => ({
  now, customerId: "cliente", customerPaidOrders: 0, customerUses: 0, subtotalCents: 6000, deliveryFeeCents: 400,
  storeId: "pizzaria", categoryId: "restaurantes", cityId: "jg", ...extra,
});
const message = (rules: CouponRules | null, extra: Partial<CouponContext> = {}) => {
  const result = validateCoupon(rules, context(extra));
  return result.ok ? null : result.message;
};

describe("validateCoupon", () => {
  it("PRIMEIRA: R$ 10,00 na primeira compra, mínimo de R$ 30,00, pago pela plataforma", () => {
    const first = coupon({ code: "PRIMEIRA", minOrderCents: 3000, firstOrderOnly: true });
    expect(validateCoupon(first, context())).toEqual({ ok: true, productDiscountCents: 1000, deliveryDiscountCents: 0, paidBy: "platform" });
    expect(message(first, { customerPaidOrders: 1 })).toBe("Este cupom é só para a primeira compra");
    expect(message(first, { subtotalCents: 2999 })).toBe("Pedido mínimo de R$ 30,00 para este cupom");
  });

  it("FRETEGRATIS: tira a taxa de entrega acima de R$ 50,00", () => {
    const freeDelivery = coupon({ type: "free_delivery", valueCents: null, minOrderCents: 5000 });
    expect(validateCoupon(freeDelivery, context())).toEqual({ ok: true, productDiscountCents: 0, deliveryDiscountCents: 400, paidBy: "platform" });
    expect(message(freeDelivery, { subtotalCents: 4000 })).toBe("Pedido mínimo de R$ 50,00 para este cupom");
    expect(message(freeDelivery, { deliveryFeeCents: 0 })).toBe("Este cupom é de frete grátis, e este pedido não tem taxa de entrega");
  });

  it("PIZZA10: 10% só na pizzaria, com teto de R$ 15,00, pago pela loja", () => {
    const pizza = coupon({ type: "percent", valueCents: null, percent: 10, maxDiscountCents: 1500, paidBy: "store", storeIds: ["pizzaria"] });
    expect(validateCoupon(pizza, context())).toMatchObject({ ok: true, productDiscountCents: 600, paidBy: "store" });
    expect(validateCoupon(pizza, context({ subtotalCents: 20000 }))).toMatchObject({ productDiscountCents: 1500 });
    expect(message(pizza, { storeId: "burger" })).toBe("Este cupom não vale para esta loja");
  });

  it("VELHO e ESGOTOU dizem por que não valem", () => {
    expect(message(coupon({ expiresAt: new Date("2026-09-29T00:00:00-03:00") }))).toBe("Cupom expirado");
    expect(message(coupon({ maxUses: 5, usesCount: 5 }))).toBe("Este cupom já esgotou");
  });

  it("refuses unknown, disabled, not started, already used and someone else's coupons", () => {
    expect(message(null)).toBe("Cupom não encontrado");
    expect(message(coupon({ active: false }))).toBe("Cupom não encontrado");
    expect(message(coupon({ startsAt: new Date("2026-10-10T00:00:00-03:00") }))).toBe("Este cupom ainda não começou a valer");
    expect(message(coupon(), { customerUses: 1 })).toBe("Você já usou este cupom");
    expect(message(coupon({ ownerProfileId: "outra-pessoa" }))).toBe("Cupom não encontrado");
    expect(validateCoupon(coupon({ ownerProfileId: "cliente" }), context()).ok).toBe(true);
  });

  it("restricts by category and city", () => {
    expect(message(coupon({ categoryIds: ["lanches"] }))).toBe("Este cupom não vale para esta categoria");
    expect(message(coupon({ cityIds: ["outra"] }))).toBe("Este cupom não vale para esta cidade");
    expect(validateCoupon(coupon({ categoryIds: ["restaurantes"], cityIds: ["jg"] }), context()).ok).toBe(true);
  });

  it("never discounts more than the products cost", () => {
    expect(validateCoupon(coupon({ valueCents: 9000 }), context({ subtotalCents: 2500 }))).toMatchObject({ productDiscountCents: 2500 });
  });
});
