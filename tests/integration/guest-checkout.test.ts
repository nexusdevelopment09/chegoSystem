import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { sql } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { placeOrder } from "@/lib/checkout/place-order";
import type { CartInput } from "@/lib/checkout/quote";
import { sql as appSql } from "@/lib/db";
import { guestOrderId, hashGuestToken } from "@/lib/orders/guest";
import { loadGuestOrder } from "@/lib/orders/queries";
import { transitionOrder } from "@/lib/orders/transitions";

// Compra sem conta, pelo mesmo código do app, no banco de teste.

const AT = new Date("2026-10-09T15:00:00-03:00");
let market: { id: string; owner_id: string; min_order_cents: number };
let product: { id: string; price_cents: number };
let hood: string;
let quantity: number;

const cart = (guest: CartInput["guest"], extra: Partial<CartInput> = {}): CartInput => ({
  storeId: market.id, fulfillment: "delivery", ageConfirmed: false, missingItemPolicy: "remove", notes: "", paymentMethod: "pix", couponCode: null,
  items: [{ key: "item-1", productId: product.id, quantity, notes: "", picks: [] }], guest, ...extra,
});
const guest = { name: "Visitante Teste", phone: "(82) 98888-7777", street: "Rua das Flores", number: "10", neighborhoodId: "", reference: "", complement: "" };

beforeAll(async () => {
  [market] = await sql`select id, owner_id, min_order_cents from stores where slug = 'mercado-boa-compra'`;
  [product] = await sql`
    select p.id, p.price_cents from products p
    where p.store_id = ${market.id} and p.available and p.deleted_at is null and not p.requires_age_check
      and not exists (select 1 from product_option_groups g where g.product_id = p.id)
      and not exists (select 1 from product_availability a where a.product_id = p.id)
      and p.max_per_order is null and p.weight_step_grams is null
    order by p.price_cents desc limit 1`;
  quantity = Math.max(1, Math.ceil(market.min_order_cents / product.price_cents));
  [{ id: hood }] = await sql`
    select n.id from store_delivery_areas a join neighborhoods n on n.id = a.neighborhood_id where a.store_id = ${market.id} and not n.is_rural limit 1`;
  guest.neighborhoodId = hood;
});

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("compra sem conta", () => {
  it("pedido com nome, telefone e endereço digitados; acompanha pelo token, que só existe como hash", async () => {
    const placed = await placeOrder(cart(guest), null, AT);
    if (!placed.ok) throw new Error(placed.errors.join(" | "));
    expect(placed.guestToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const [order] = await sql`select customer_id, customer_name, customer_phone, guest_token_hash, status, address_snapshot from orders where id = ${placed.orderId}`;
    expect(order).toMatchObject({ customer_id: null, customer_name: "Visitante Teste", customer_phone: "+5582988887777", status: "paid" });
    expect(order.guest_token_hash).toBe(hashGuestToken(placed.guestToken!));
    expect(order.guest_token_hash).not.toContain(placed.guestToken);
    expect(order.address_snapshot).toMatchObject({ street: "Rua das Flores", number: "10" });

    expect(await guestOrderId(placed.guestToken!)).toBe(placed.orderId);
    expect(await guestOrderId("x".repeat(32))).toBeNull();
    expect(await guestOrderId("curto")).toBeNull();
    expect((await loadGuestOrder(placed.orderId))?.code).toBeTruthy();

    // A loja segue o fluxo normal; nenhuma notificação é tentada para um cliente que não existe.
    await appSql.begin((tx) => transitionOrder(tx, { orderId: placed.orderId, to: "accepted", actor: "staff", actorId: market.owner_id, at: AT }));
    expect((await sql`select status from orders where id = ${placed.orderId}`)[0].status).toBe("accepted");
  });

  it("sem nome/telefone válidos, sem endereço ou com cupom: recusa com o motivo", async () => {
    const bad = await placeOrder(cart({ ...guest, name: "A", phone: "123" }), null, AT);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors).toEqual(expect.arrayContaining(["Diga seu nome completo.", "Oxe, esse telefone não parece certo. Use DDD + número."]));

    const noAddress = await placeOrder(cart({ ...guest, street: "" }), null, AT);
    expect(!noAddress.ok && noAddress.errors).toContain("Oxe, faltou o endereço.");

    const coupon = await placeOrder(cart(guest, { couponCode: "QUALQUER" }), null, AT);
    expect(coupon.ok).toBe(true); // o cupom é ignorado com aviso na cotação, sem desconto
    if (coupon.ok) expect((await sql`select discount_cents from orders where id = ${coupon.orderId}`)[0].discount_cents).toBe(0);

    const nobody = await placeOrder(cart(null), null, AT);
    expect(!nobody.ok && nobody.errors[0]).toMatch(/nome e telefone/);
  });
});
