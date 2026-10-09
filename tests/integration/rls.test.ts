import { afterAll, describe, expect, it } from "vitest";
import { asUser, createWorld, ids, inRolledBackTransaction, sql } from "./helpers";

afterAll(() => sql.end());

describe("Row Level Security", () => {
  it("is enabled on every table", async () => {
    const unprotected = await sql`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(unprotected.map((row) => row.relname)).toEqual([]);
  });

  it("a customer only sees their own orders and items", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);

      const orders = await asUser(tx, w.customerA, (q) =>
        q<{ id: string }[]>`select id from orders where city_id = ${w.city}`);
      expect(ids(orders)).toEqual([w.orderA1, w.unpaidOrder].sort());

      const foreignItems = await asUser(tx, w.customerA, (q) =>
        q`select id from order_items where order_id in (${w.orderA2}, ${w.orderB})`);
      expect(foreignItems).toHaveLength(0);
    }));

  it("store staff only see their store's orders, and only after payment", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);

      const orders = await asUser(tx, w.attendantA, (q) =>
        q<{ id: string }[]>`select id from orders where city_id = ${w.city}`);
      expect(ids(orders)).toEqual([w.orderA1, w.orderA2].sort());

      const otherStore = await asUser(tx, w.attendantB, (q) =>
        q<{ id: string }[]>`select id from orders where city_id = ${w.city}`);
      expect(ids(otherStore)).toEqual([w.orderB]);
    }));

  it("a courier only sees the deliveries assigned to them", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);

      const orders = await asUser(tx, w.courierA, (q) =>
        q<{ id: string }[]>`select id from orders where city_id = ${w.city}`);
      expect(ids(orders)).toEqual([w.orderA1]);

      const items = await asUser(tx, w.courierA, (q) =>
        q`select id from order_items where order_id = ${w.orderA2}`);
      expect(items).toHaveLength(0);
    }));

  it("attendants and couriers see no financial data; the owner sees only their store's", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const stores = [w.storeA, w.storeB];

      for (const member of [w.attendantA, w.courierA]) {
        const seen = await asUser(tx, member, async (q) => ({
          ledger: await q`select id from ledger_entries where order_id in (${w.orderA1}, ${w.orderB})`,
          privateData: await q`select store_id from store_private where store_id in ${q(stores)}`,
          subscriptions: await q`select id from store_subscriptions where store_id in ${q(stores)}`,
        }));
        expect(seen.ledger).toHaveLength(0);
        expect(seen.privateData).toHaveLength(0);
        expect(seen.subscriptions).toHaveLength(0);
      }

      const owner = await asUser(tx, w.ownerA, async (q) => ({
        ledger: await q`select store_id, account from ledger_entries where order_id in (${w.orderA1}, ${w.orderB})`,
        privateData: await q`select store_id from store_private where store_id in ${q(stores)}`,
      }));
      expect(owner.ledger).toEqual([{ store_id: w.storeA, account: "store" }]);
      expect(owner.privateData).toEqual([{ store_id: w.storeA }]);
    }));

  it("only the admin reads the audit log", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const count = (user: string | null) =>
        asUser(tx, user, async (q) => (await q`select id from audit_logs where actor_id = ${w.admin}`).length);

      expect(await count(w.admin)).toBe(1);
      for (const user of [w.customerA, w.ownerA, w.attendantA, w.courierA, null]) {
        expect(await count(user)).toBe(0);
      }
    }));

  it("the admin sees everything", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const seen = await asUser(tx, w.admin, async (q) => ({
        orders: await q`select id from orders where city_id = ${w.city}`,
        stores: await q`select id from stores where city_id = ${w.city}`,
        ledger: await q`select id from ledger_entries where order_id in (${w.orderA1}, ${w.orderB})`,
      }));
      expect(seen.orders).toHaveLength(4);
      expect(seen.stores).toHaveLength(3);
      expect(seen.ledger).toHaveLength(3);
    }));

  it("an anonymous visitor sees open stores and menus, and nothing private", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const seen = await asUser(tx, null, async (q) => ({
        stores: await q<{ id: string }[]>`select id from stores where city_id = ${w.city}`,
        products: await q`select id from products where id in (${w.productA}, ${w.productB})`,
        orders: await q`select id from orders where city_id = ${w.city}`,
        profiles: await q`select id from profiles`,
        coupons: await q`select id from coupons`,
        addresses: await q`select id from addresses`,
      }));
      expect(ids(seen.stores)).toEqual([w.storeA, w.storeB].sort());
      expect(seen.products).toHaveLength(2);
      expect(seen.orders).toHaveLength(0);
      expect(seen.profiles).toHaveLength(0);
      expect(seen.coupons).toHaveLength(0);
      expect(seen.addresses).toHaveLength(0);
    }));

  it("a pending store is hidden from customers but visible to its owner", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const find = (user: string) =>
        asUser(tx, user, (q) => q`select id from stores where id = ${w.pendingStore}`);

      expect(await find(w.customerA)).toHaveLength(0);
      expect(await find(w.ownerA)).toHaveLength(0);
      expect(await find(w.ownerB)).toHaveLength(1);
    }));

  it("a customer cannot read another customer's profile or addresses", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const seen = await asUser(tx, w.customerB, async (q) => ({
        profiles: await q<{ id: string }[]>`select id from profiles`,
        addresses: await q`select id from addresses`,
      }));
      expect(ids(seen.profiles)).toEqual([w.customerB]);
      expect(seen.addresses).toHaveLength(0);
    }));

  it("staff edit their own menu but not another store's", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);

      const own = await asUser(tx, w.attendantA, (q) =>
        q`update products set available = false where id = ${w.productA} returning id`);
      expect(own).toHaveLength(1);

      const foreign = await asUser(tx, w.attendantA, (q) =>
        q`update products set available = false where id = ${w.productB} returning id`);
      expect(foreign).toHaveLength(0);

      await expect(
        asUser(tx, w.attendantA, (q) =>
          q`insert into products (store_id, name, price_cents) values (${w.storeB}, 'Intruso', 1)`),
      ).rejects.toThrow(/row-level security/);

      await expect(
        asUser(tx, w.courierA, (q) =>
          q`insert into products (store_id, name, price_cents) values (${w.storeA}, 'Intruso', 1)`),
      ).rejects.toThrow(/row-level security/);
    }));

  it("nobody changes money, order status or their own role from the browser side", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const denied = /permission denied/;

      await expect(
        asUser(tx, w.customerA, (q) => q`update orders set status = 'delivered' where id = ${w.orderA1}`),
      ).rejects.toThrow(denied);
      await expect(
        asUser(tx, w.ownerA, (q) => q`update store_private set commission_rate = 0 where store_id = ${w.storeA}`),
      ).rejects.toThrow(denied);
      await expect(
        asUser(tx, w.ownerA, (q) => q`update stores set featured_until = now() + interval '1 year' where id = ${w.storeA}`),
      ).rejects.toThrow(denied);
      await expect(
        asUser(tx, w.customerA, (q) => q`update profiles set role = 'admin' where id = ${w.customerA}`),
      ).rejects.toThrow(denied);
      await expect(
        asUser(tx, w.ownerA, (q) => q`delete from ledger_entries where store_id = ${w.storeA}`),
      ).rejects.toThrow(denied);

      const renamed = await asUser(tx, w.customerA, (q) =>
        q`update profiles set full_name = 'Novo Nome' where id = ${w.customerA} returning id`);
      expect(renamed).toHaveLength(1);
    }));

  it("internal tables cannot even be read", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      for (const table of ["sessions", "login_codes", "rate_limits", "webhook_events"]) {
        await expect(
          asUser(tx, w.admin, (q) => q`select 1 from ${q(table)} limit 1`),
        ).rejects.toThrow(/permission denied/);
      }
    }));
});
