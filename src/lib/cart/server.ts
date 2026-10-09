import "server-only";
import { getCurrentProfile } from "@/lib/auth/session";
import { loadProducts } from "@/lib/catalog/queries";
import { describeOptions, resolveSelection, toSnapshot } from "@/lib/catalog/selection";
import { cartInputSchema } from "@/lib/checkout/quote";
import { sql, withUser } from "@/lib/db";
import type { Cart } from "./local";

const savedCartSchema = cartInputSchema.pick({ storeId: true, items: true, notes: true });

/** Keeps a copy of the cart on the server, so it follows the customer to another device. */
export async function saveCartOnServer(payload: unknown) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  if (payload === null) {
    await sql`delete from carts where profile_id = ${profile.id}`;
    return;
  }
  const parsed = savedCartSchema.safeParse(payload);
  if (!parsed.success) return;

  await withUser(profile.id, async (tx) => {
    await tx`delete from carts where profile_id = ${profile.id}`;
    const [cart] = await tx<{ id: string }[]>`
      insert into carts (profile_id, store_id, notes) values (${profile.id}, ${parsed.data.storeId}, ${parsed.data.notes})
      returning id`;
    for (const item of parsed.data.items) {
      await tx`
        insert into cart_items (cart_id, product_id, quantity, notes, selections)
        values (${cart.id}, ${item.productId}, ${item.quantity}, ${item.notes}, ${tx.json(item.picks)})`;
    }
  });
}

/** The cart saved on the server, rebuilt with today's names and prices. */
export async function loadCartFromServer(): Promise<Cart | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const rows = await sql<{
    id: string; store_id: string; store_slug: string; store_name: string; cart_notes: string | null;
    product_id: string; quantity: number; notes: string | null; selections: { groupId: string; optionId: string; quantity: number }[];
  }[]>`
    select i.id, c.store_id, s.slug as store_slug, s.name as store_name, c.notes as cart_notes,
           i.product_id, i.quantity, i.notes, i.selections
    from carts c
    join stores s on s.id = c.store_id
    join cart_items i on i.cart_id = c.id
    where c.profile_id = ${profile.id}
    order by i.created_at`;
  if (rows.length === 0) return null;

  const products = await loadProducts(rows.map((row) => row.product_id));
  const items = rows.flatMap((row) => {
    const product = products.get(row.product_id);
    if (!product) return [];
    const selection = resolveSelection(product.priceCents, product.groups, row.selections);
    if (!selection.ok) return [];
    return [{
      key: row.id, productId: product.id, name: product.name, imageUrl: product.imageUrl,
      unitPriceCents: selection.unitPriceCents, quantity: row.quantity, notes: row.notes ?? "",
      picks: row.selections, lines: describeOptions(toSnapshot(selection.groups)),
    }];
  });
  if (items.length === 0) return null;

  return { storeId: rows[0].store_id, storeSlug: rows[0].store_slug, storeName: rows[0].store_name, notes: rows[0].cart_notes ?? "", items };
}
