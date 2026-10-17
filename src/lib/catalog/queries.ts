import "server-only";
import { sql } from "@/lib/db";
import type { ProductRules } from "./availability";
import type { PriceMode } from "./pricing";
import type { GroupView } from "./selection";

export type ProductDetail = {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  sectionName: string | null;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  requiresAgeCheck: boolean;
  maxPerOrder: number | null;
  /** Vendido por peso: porções de N gramas (null = por unidade). priceCents é o preço de uma porção. */
  weightStepGrams: number | null;
  pricePerKgCents: number | null;
  /** Por peso: o mínimo de gramas por pedido. */
  weightMinGrams: number | null;
  rules: ProductRules;
  groups: GroupView[];
};

type ProductRow = {
  id: string; store_id: string; store_slug: string; store_name: string; section_name: string | null;
  name: string; description: string; price_cents: number; image_url: string | null;
  requires_age_check: boolean; max_per_order: number | null; available: boolean;
  track_stock: boolean; stock_qty: number | null; min_lead_minutes: number;
  weight_step_grams: number | null; price_per_kg_cents: number | null; weight_min_grams: number | null;
};

/**
 * Produtos com os grupos de opções, os preços naquele produto e as faixas de
 * disponibilidade, direto do banco. Só produtos de lojas que os clientes podem
 * ver. É daqui que a página do produto e o checkout tiram o preço.
 */
export async function loadProducts(productIds: string[]): Promise<Map<string, ProductDetail>> {
  const result = new Map<string, ProductDetail>();
  if (productIds.length === 0) return result;

  const products = await sql<ProductRow[]>`
    select p.id, p.store_id, s.slug as store_slug, s.name as store_name, sec.name as section_name,
           p.name, p.description, p.price_cents, p.image_url, p.requires_age_check, p.max_per_order,
           p.available, p.track_stock, p.stock_qty, p.min_lead_minutes, p.weight_step_grams, p.price_per_kg_cents, p.weight_min_grams
    from products p
    join stores s on s.id = p.store_id
    left join product_sections sec on sec.id = p.section_id
    where p.id = any(${productIds}::uuid[])
      and p.deleted_at is null
      and s.status in ('active', 'paused')`;

  for (const row of products) {
    result.set(row.id, {
      id: row.id, storeId: row.store_id, storeSlug: row.store_slug, storeName: row.store_name,
      sectionName: row.section_name, name: row.name, description: row.description,
      priceCents: row.price_cents, imageUrl: row.image_url, requiresAgeCheck: row.requires_age_check,
      maxPerOrder: row.max_per_order, weightStepGrams: row.weight_step_grams, pricePerKgCents: row.price_per_kg_cents,
      weightMinGrams: row.weight_min_grams,
      rules: {
        available: row.available, trackStock: row.track_stock, stockQty: row.stock_qty,
        minLeadMinutes: row.min_lead_minutes, windows: [],
      },
      groups: [],
    });
  }
  const ids = [...result.keys()];
  if (ids.length === 0) return result;

  const windows = await sql<{ product_id: string; weekday: number; starts_at: string; ends_at: string }[]>`
    select product_id, weekday, starts_at::text, ends_at::text
    from product_availability
    where product_id = any(${ids}::uuid[])`;
  for (const window of windows) {
    result.get(window.product_id)!.rules.windows.push({
      weekday: window.weekday, startsAt: window.starts_at, endsAt: window.ends_at,
    });
  }

  const groups = await sql<{
    product_id: string; group_id: string; name: string; required: boolean; min_choices: number;
    max_choices: number; allow_repeat: boolean; price_mode: PriceMode; free_quantity: number;
  }[]>`
    select pog.product_id, g.id as group_id, g.name, pog.required, pog.min_choices, pog.max_choices,
           pog.allow_repeat, pog.price_mode, pog.free_quantity
    from product_option_groups pog
    join option_groups g on g.id = pog.group_id
    where pog.product_id = any(${ids}::uuid[])
    order by pog.sort_order`;

  const options = await sql<{
    product_id: string; group_id: string; id: string; name: string; category_label: string | null;
    price_cents: number; available: boolean;
  }[]>`
    select pog.product_id, o.group_id, o.id, o.name, o.category_label, o.available,
           coalesce(pop.price_cents, o.default_price_cents) as price_cents
    from product_option_groups pog
    join options o on o.group_id = pog.group_id
    left join product_option_prices pop on pop.product_id = pog.product_id and pop.option_id = o.id
    where pog.product_id = any(${ids}::uuid[])
    order by o.sort_order`;

  for (const group of groups) {
    result.get(group.product_id)!.groups.push({
      id: group.group_id, name: group.name, required: group.required, min: group.min_choices,
      max: group.max_choices, allowRepeat: group.allow_repeat, mode: group.price_mode,
      freeQuantity: group.free_quantity,
      options: options
        .filter((option) => option.product_id === group.product_id && option.group_id === group.group_id)
        .map((option) => ({
          id: option.id, name: option.name, label: option.category_label,
          priceCents: option.price_cents, available: option.available,
        })),
    });
  }

  return result;
}

export async function getProductDetail(productId: string): Promise<ProductDetail | null> {
  return (await loadProducts([productId])).get(productId) ?? null;
}
