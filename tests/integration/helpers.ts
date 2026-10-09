import postgres from "postgres";
import { TEST_DATABASE_URL } from "../reset-test-db";

// Integration tests talk to the test database (see tests/reset-test-db.ts).
export const sql = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });

type Tx = postgres.TransactionSql;

class Rollback extends Error {}

/**
 * Runs a test inside a transaction that is always rolled back, so tests never
 * leave data behind and do not depend on the seed.
 */
export async function inRolledBackTransaction(run: (tx: Tx) => Promise<void>) {
  try {
    await sql.begin(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/**
 * Runs queries as a user with Row Level Security applied, the same way
 * `withUser` does in the app. `null` is an anonymous visitor. A database
 * error (e.g. "permission denied") rejects without breaking the outer test.
 */
export async function asUser<T>(
  tx: Tx,
  profileId: string | null,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    const result = await tx.savepoint(async (sp) => {
      await sp`select set_config('app.user_id', ${profileId ?? ""}, true)`;
      await sp`set local role app_user`;
      return run(sp);
    });
    return result as T;
  } finally {
    await tx`reset role`;
    await tx`select set_config('app.user_id', '', true)`;
  }
}

export type World = Awaited<ReturnType<typeof createWorld>>;

/** Two stores with their teams, two customers and a few orders. */
export async function createWorld(tx: Tx) {
  const tag = Math.random().toString(36).slice(2, 8);

  const [city] = await tx`
    insert into cities (name, state, slug, order_code_prefix)
    values ('Cidade Teste', 'AL', ${`cidade-${tag}`}, ${`T${tag}`}) returning id`;
  const [hood] = await tx`
    insert into neighborhoods (city_id, name) values (${city.id}, 'Centro') returning id`;
  const [category] = await tx`
    insert into categories (name, slug) values ('Lanches', ${`lanches-${tag}`}) returning id`;

  const profile = async (name: string, role = "customer") => {
    const [row] = await tx`
      insert into profiles (full_name, role) values (${name}, ${role}::user_role) returning id`;
    return row.id as string;
  };

  const admin = await profile("Admin", "admin");
  const customerA = await profile("Cliente A");
  const customerB = await profile("Cliente B");
  const ownerA = await profile("Dono A", "merchant");
  const attendantA = await profile("Atendente A", "merchant");
  const courierA = await profile("Entregador A", "merchant");
  const otherCourierA = await profile("Entregador A2", "merchant");
  const ownerB = await profile("Dono B", "merchant");
  const attendantB = await profile("Atendente B", "merchant");

  const store = async (name: string, owner: string, status: string) => {
    const [row] = await tx`
      insert into stores (city_id, category_id, owner_id, name, slug, status)
      values (${city.id}, ${category.id}, ${owner}, ${name}, ${`${name}-${tag}`.toLowerCase()}, ${status}::store_status)
      returning id`;
    await tx`insert into store_private (store_id, commission_rate) values (${row.id}, 0.10)`;
    await tx`insert into store_members (store_id, profile_id, role) values (${row.id}, ${owner}, 'owner')`;
    return row.id as string;
  };

  const storeA = await store("LojaA", ownerA, "active");
  const storeB = await store("LojaB", ownerB, "active");
  const pendingStore = await store("LojaPendente", ownerB, "pending");

  await tx`
    insert into store_members (store_id, profile_id, role) values
      (${storeA}, ${attendantA}, 'attendant'),
      (${storeA}, ${courierA}, 'courier'),
      (${storeA}, ${otherCourierA}, 'courier'),
      (${storeB}, ${attendantB}, 'attendant')`;

  const product = async (storeId: string, name: string) => {
    const [row] = await tx`
      insert into products (store_id, name, price_cents) values (${storeId}, ${name}, 1000) returning id`;
    return row.id as string;
  };
  const productA = await product(storeA, "Produto A");
  const productB = await product(storeB, "Produto B");

  let orderNumber = 0;
  const order = async (opts: {
    customer: string;
    storeId: string;
    paid: boolean;
    courier?: string;
  }) => {
    orderNumber += 1;
    const [row] = await tx`
      insert into orders (
        code, city_id, customer_id, store_id, status, fulfillment, customer_name,
        subtotal_cents, commission_rate, commission_cents, store_amount_cents,
        platform_amount_cents, total_cents, payment_method, paid_at, courier_id
      ) values (
        ${`T${tag}-${orderNumber}`}, ${city.id}, ${opts.customer}, ${opts.storeId},
        ${opts.paid ? "paid" : "awaiting_payment"}::order_status, 'delivery', 'Cliente',
        1000, 0.10, 100, 900, 100, 1000, 'pix',
        ${opts.paid ? tx`now()` : null}, ${opts.courier ?? null}
      ) returning id`;
    await tx`
      insert into order_items (order_id, name, unit_price_cents, quantity, line_total_cents)
      values (${row.id}, 'Item', 1000, 1, 1000)`;
    return row.id as string;
  };

  const orderA1 = await order({ customer: customerA, storeId: storeA, paid: true, courier: courierA });
  const orderA2 = await order({ customer: customerB, storeId: storeA, paid: true, courier: otherCourierA });
  const unpaidOrder = await order({ customer: customerA, storeId: storeA, paid: false });
  const orderB = await order({ customer: customerB, storeId: storeB, paid: true });

  await tx`
    insert into ledger_entries (account, store_id, direction, amount_cents, reason, order_id) values
      ('store', ${storeA}, 'credit', 900, 'sale', ${orderA1}),
      ('platform', null, 'credit', 100, 'commission', ${orderA1}),
      ('store', ${storeB}, 'credit', 900, 'sale', ${orderB})`;

  await tx`
    insert into audit_logs (actor_id, action, entity_type) values (${admin}, 'test.action', 'store')`;

  await tx`
    insert into addresses (profile_id, street, neighborhood_id) values (${customerA}, 'Rua A', ${hood.id})`;

  await tx`
    insert into coupons (code, type, value_cents, paid_by) values (${`CUPOM${tag}`.toUpperCase()}, 'fixed', 500, 'platform')`;

  return {
    city: city.id as string,
    admin, customerA, customerB,
    ownerA, attendantA, courierA, otherCourierA, ownerB, attendantB,
    storeA, storeB, pendingStore,
    productA, productB,
    orderA1, orderA2, unpaidOrder, orderB,
  };
}

/** Sorted ids, to compare result sets without caring about order. */
export const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id).sort();
