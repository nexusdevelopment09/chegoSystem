import { afterAll, describe, expect, it } from "vitest";
import { sql } from "./helpers";

afterAll(() => sql.end());

const count = async (query: PromiseLike<readonly { total: unknown }[]>) =>
  Number((await query)[0]?.total);

describe("development seed", () => {
  it("creates the cities, stores and users of the specification", async () => {
    expect(await count(sql`select count(*) as total from cities`)).toBe(2);
    expect(await count(sql`select count(*) as total from neighborhoods where is_rural`)).toBe(3);

    const stores = await sql`select status, count(*)::int as total from stores group by status order by status`;
    expect(Object.fromEntries(stores.map((row) => [row.status, row.total]))).toEqual({
      pending: 1, active: 15, suspended: 1,
    });
    // 14 active in Joaquim Gomes; the 15th is in the neighbor city.
    expect(await count(sql`
      select count(*) as total from stores s join cities c on c.id = s.city_id
      where s.status = 'active' and c.slug = 'joaquim-gomes'`)).toBe(14);

    expect(await count(sql`select count(*) as total from profiles where role = 'admin'`)).toBe(1);
    expect(await count(sql`select count(*) as total from profiles where role = 'customer'`)).toBe(10);
    expect(await count(sql`select count(*) as total from store_members where role = 'attendant'`)).toBe(2);
    expect(await count(sql`select count(*) as total from store_members where role = 'courier'`)).toBe(1);
  });

  it("gives every test user a valid Brazilian mobile number", async () => {
    const invalid = await sql`select full_name, phone from profiles where phone !~ '^\\+55829\\d{8}$'`;
    expect(invalid).toHaveLength(0);
  });

  it("prices the pizza flavors per size and marks Camarão as sold out", async () => {
    const prices = await sql<{ flavor: string; price_cents: number }[]>`
      select o.name as flavor, pop.price_cents
      from products p
      join product_option_prices pop on pop.product_id = p.id
      join options o on o.id = pop.option_id
      where p.name = 'Pizza Grande (8 fatias)' and o.name in ('Calabresa', 'Carne de Sol com Queijo Coalho', 'Catupiry')
      order by o.name`;
    expect(prices).toEqual([
      { flavor: "Calabresa", price_cents: 4500 },
      { flavor: "Carne de Sol com Queijo Coalho", price_cents: 5600 },
      { flavor: "Catupiry", price_cents: 800 },
    ]);

    const [link] = await sql`
      select pog.max_choices, pog.price_mode
      from products p
      join product_option_groups pog on pog.product_id = p.id
      join option_groups g on g.id = pog.group_id
      where p.name = 'Pizza Grande (8 fatias)' and g.name = 'Sabores'`;
    expect(link).toEqual({ max_choices: 2, price_mode: "highest" });

    const [shrimp] = await sql`select available from options where name = 'Camarão'`;
    expect(shrimp.available).toBe(false);
  });

  it("generates about 400 orders whose money always closes", async () => {
    const total = await count(sql`select count(*) as total from orders`);
    expect(total).toBeGreaterThanOrEqual(400);

    const broken = await sql`
      select code from orders
      where store_amount_cents + platform_amount_cents <> total_cents
         or subtotal_cents - discount_cents + delivery_fee_cents + service_fee_cents <> total_cents
         or subtotal_cents <> (select sum(line_total_cents) from order_items i where i.order_id = orders.id)`;
    expect(broken).toHaveLength(0);

    // Every paid order has its sale in the ledger, matching the split.
    const unbalanced = await sql`
      select o.code
      from orders o
      where o.paid_at is not null
        and o.total_cents <> (
          select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
          from ledger_entries l where l.order_id = o.id and l.reason = 'sale'
        )`;
    expect(unbalanced).toHaveLength(0);

    const statuses = await sql`select distinct status from orders`;
    expect(statuses.map((row) => row.status)).toEqual(
      expect.arrayContaining(["delivered", "picked_up", "cancelled", "rejected", "refunded", "partially_refunded", "expired"]),
    );
  });

  it("refunds fully what was rejected or cancelled", async () => {
    const wrong = await sql`
      select code from orders
      where status in ('rejected', 'cancelled', 'refunded') and refunded_cents <> total_cents`;
    expect(wrong).toHaveLength(0);
  });

  it("leaves the ready-made situations for manual testing", async () => {
    const live = await sql<{ customer_name: string; status: string; store: string }[]>`
      select o.customer_name, o.status, s.slug as store
      from orders o join stores s on s.id = o.store_id
      where o.status in ('awaiting_payment', 'paid', 'preparing', 'out_for_delivery', 'accepted')
      order by o.status`;
    expect(live).toEqual(expect.arrayContaining([
      { customer_name: "Eduarda Santos", status: "awaiting_payment", store: "acai-tropical" },
      { customer_name: "Bruno Henrique Lima", status: "paid", store: "pizzaria-forno-de-barro" },
      { customer_name: "Ana Clara Souza", status: "preparing", store: "brasa-burger" },
      { customer_name: "Felipe Rocha", status: "out_for_delivery", store: "pizzaria-forno-de-barro" },
      { customer_name: "Ana Clara Souza", status: "accepted", store: "delicias-da-vo" },
    ]));

    expect(await count(sql`select count(*) as total from orders o join profiles p on p.id = o.customer_id where p.full_name = 'Diego Alves'`)).toBe(0);
    expect(await count(sql`select count(*) as total from profiles where blocked_at is not null`)).toBe(1);
    expect(await count(sql`select count(*) as total from profiles where birth_date > now() - interval '18 years'`)).toBe(1);
    expect(await count(sql`select count(*) as total from support_tickets where status = 'open'`)).toBe(1);
    expect(await count(sql`select count(*) as total from invoices where status = 'overdue'`)).toBe(1);
    expect(await count(sql`select count(*) as total from reviews where hidden_at is not null`)).toBe(1);
    expect(await count(sql`select count(*) as total from blocked_message_attempts`)).toBe(1);
  });

  it("sets up the five test coupons", async () => {
    const coupons = await sql`select code, uses_count, max_uses, expires_at < now() as expired from coupons where owner_profile_id is null order by code`;
    expect(coupons.map((row) => row.code)).toEqual(["ESGOTOU", "FRETEGRATIS", "PIZZA10", "PRIMEIRA", "VELHO"]);
    expect(coupons[0]).toMatchObject({ uses_count: 5, max_uses: 5 });
    expect(coupons[4].expired).toBe(true);
  });

  it("stores every picture the seed points to", async () => {
    const { existsSync } = await import("node:fs");
    const urls = await sql<{ url: string }[]>`
      select image_url as url from products where image_url is not null
      union all select logo_url from stores
      union all select cover_url from stores
      union all select image_url from banners`;
    const missing = urls.filter(({ url }) => !existsSync(`storage/${url.replace("/files/", "")}`));
    expect(missing).toHaveLength(0);
    expect(await count(sql`select count(*) as total from products where image_url is null`)).toBeGreaterThan(0);
  });
});
