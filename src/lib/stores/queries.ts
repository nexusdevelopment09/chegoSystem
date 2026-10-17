import "server-only";
import { productStatus, type ProductStatus } from "@/lib/catalog/availability";
import { loadProducts } from "@/lib/catalog/queries";
import { startingPriceCents } from "@/lib/catalog/selection";
import { sql } from "@/lib/db";
import { storeAvailability, type Shift, type StoreAvailability } from "./hours";

export type DeliveryArea = { feeCents: number; minMinutes: number; maxMinutes: number };

export type StoreSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  categoryName: string;
  categorySlug: string;
  ratingAvg: number | null;
  ratingCount: number;
  minOrderCents: number;
  prepMinutes: number;
  busyExtraMinutes: number;
  offersDelivery: boolean;
  offersPickup: boolean;
  acceptsScheduled: boolean;
  featured: boolean;
  createdAt: Date;
  availability: StoreAvailability;
  /** Entrega no bairro do cliente; null quando a loja não entrega lá. */
  area: DeliveryArea | null;
  /** Menor taxa de entrega da loja, para quando não se sabe o bairro. */
  minFeeCents: number | null;
  shifts: Shift[];
};

type StoreRow = {
  id: string; slug: string; name: string; description: string; logo_url: string | null; cover_url: string | null;
  status: "active" | "paused"; manual_state: "auto" | "open" | "closed"; paused_until: Date | null;
  busy_extra_minutes: number; prep_time_minutes: number; min_order_cents: number;
  offers_delivery: boolean; offers_pickup: boolean; accepts_scheduled: boolean;
  rating_avg: string | null; rating_count: number; featured: boolean; created_at: Date;
  category_name: string; category_slug: string;
  shifts: Shift[]; closures: { startsAt: string; endsAt: string }[];
  area_fee: number | null; area_min: number | null; area_max: number | null; min_fee: number | null;
};

export type StoreFilters = {
  cityId: string;
  neighborhoodId?: string | null;
  categorySlug?: string;
  query?: string;
  slug?: string;
  ids?: string[];
};

/** Transforma "pizza" em "%pizza%", escapando os curingas do LIKE que o usuário digitou. */
export const likePattern = (text: string) => `%${text.trim().replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Lojas que os clientes podem ver em uma cidade, já na ordem padrão justa:
 * abertas primeiro, depois as que entregam no bairro do cliente
 * (mais barata primeiro), depois pela avaliação. Destaques pagos nunca mudam esta ordem;
 * eles aparecem em uma seção própria e identificada.
 */
export async function listStores(filters: StoreFilters, at: Date): Promise<StoreSummary[]> {
  const rows = await sql<StoreRow[]>`
    select s.id, s.slug, s.name, s.description, s.logo_url, s.cover_url, s.status, s.manual_state, s.paused_until,
           s.busy_extra_minutes, s.prep_time_minutes, s.min_order_cents, s.offers_delivery, s.offers_pickup,
           s.accepts_scheduled, s.rating_avg, s.rating_count, s.created_at,
           coalesce(s.featured_until > ${at}, false) as featured,
           c.name as category_name, c.slug as category_slug,
           coalesce((
             select json_agg(json_build_object(
               'weekday', h.weekday, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text, 'pickupOnly', h.pickup_only))
             from store_hours h where h.store_id = s.id
           ), '[]') as shifts,
           coalesce((
             select json_agg(json_build_object('startsAt', cl.starts_at, 'endsAt', cl.ends_at))
             from store_closures cl where cl.store_id = s.id and cl.ends_at > ${at}
           ), '[]') as closures,
           a.delivery_fee_cents as area_fee, a.min_minutes as area_min, a.max_minutes as area_max,
           (select min(delivery_fee_cents) from store_delivery_areas where store_id = s.id) as min_fee
    from stores s
    join categories c on c.id = s.category_id
    left join store_delivery_areas a on a.store_id = s.id and a.neighborhood_id = ${filters.neighborhoodId ?? null}
    where s.city_id = ${filters.cityId}
      and s.status in ('active', 'paused')
      ${filters.categorySlug ? sql`and c.slug = ${filters.categorySlug}` : sql``}
      ${filters.slug ? sql`and s.slug = ${filters.slug}` : sql``}
      ${filters.ids ? sql`and s.id = any(${filters.ids}::uuid[])` : sql``}
      ${filters.query ? sql`and unaccent(s.name) ilike unaccent(${likePattern(filters.query)})` : sql``}`;

  const stores = rows.map((row): StoreSummary => ({
    id: row.id, slug: row.slug, name: row.name, description: row.description,
    logoUrl: row.logo_url, coverUrl: row.cover_url,
    categoryName: row.category_name, categorySlug: row.category_slug,
    ratingAvg: row.rating_avg === null ? null : Number(row.rating_avg), ratingCount: row.rating_count,
    minOrderCents: row.min_order_cents, prepMinutes: row.prep_time_minutes, busyExtraMinutes: row.busy_extra_minutes,
    offersDelivery: row.offers_delivery, offersPickup: row.offers_pickup, acceptsScheduled: row.accepts_scheduled,
    featured: row.featured, createdAt: row.created_at, shifts: row.shifts,
    availability: storeAvailability({
      status: row.status, manualState: row.manual_state, pausedUntil: row.paused_until, shifts: row.shifts,
      closures: row.closures.map((closure) => ({ startsAt: new Date(closure.startsAt), endsAt: new Date(closure.endsAt) })),
    }, at),
    area: row.area_fee === null ? null : { feeCents: row.area_fee, minMinutes: row.area_min!, maxMinutes: row.area_max! },
    minFeeCents: row.min_fee,
  }));

  const stateRank = { open: 0, paused: 1, closed: 2 };
  return stores.sort((a, b) =>
    stateRank[a.availability.state] - stateRank[b.availability.state]
    || Number(a.area === null) - Number(b.area === null)
    || (a.area?.feeCents ?? 0) - (b.area?.feeCents ?? 0)
    || (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0)
    || a.name.localeCompare(b.name, "pt-BR"));
}

/** "35–50 min": preparo, tempo extra de movimento alto e entrega no bairro. */
export function estimateMinutes(store: StoreSummary): string {
  const base = store.prepMinutes + store.busyExtraMinutes;
  return store.area
    ? `${base + store.area.minMinutes}–${base + store.area.maxMinutes} min`
    : `${base}–${base + 15} min`;
}

export type MenuProduct = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  fromCents: number;
  /** O preço depende de uma escolha obrigatória (sabor da pizza, tamanho...). */
  priceVaries: boolean;
  /** Vendido por peso: preço do quilo, mostrado no lugar do preço da porção. */
  pricePerKgCents: number | null;
  featured: boolean;
  status: ProductStatus;
};

export type MenuSection = { id: string; name: string; products: MenuProduct[] };

/** O cardápio da loja por seção, com os produtos esgotados no fim de cada uma. */
export async function getMenu(storeId: string, at: Date): Promise<MenuSection[]> {
  const rows = await sql<{ id: string; section_id: string | null; section_name: string | null; featured: boolean }[]>`
    select p.id, p.section_id, sec.name as section_name, p.featured
    from products p
    left join product_sections sec on sec.id = p.section_id
    where p.store_id = ${storeId} and p.deleted_at is null
    order by sec.sort_order nulls last, p.sort_order, p.name`;

  const details = await loadProducts(rows.map((row) => row.id));
  const sections: MenuSection[] = [];

  for (const row of rows) {
    const detail = details.get(row.id);
    if (!detail) continue;
    const sectionId = row.section_id ?? "outros";
    let section = sections.find((item) => item.id === sectionId);
    if (!section) {
      section = { id: sectionId, name: row.section_name ?? "Outros", products: [] };
      sections.push(section);
    }
    section.products.push({
      id: detail.id, name: detail.name, description: detail.description, imageUrl: detail.imageUrl,
      fromCents: startingPriceCents(detail.priceCents, detail.groups),
      priceVaries: startingPriceCents(detail.priceCents, detail.groups) !== detail.priceCents, featured: row.featured,
      pricePerKgCents: detail.pricePerKgCents,
      status: productStatus(detail.rules, at),
    });
  }

  for (const section of sections) {
    section.products.sort((a, b) => Number(!a.status.orderable) - Number(!b.status.orderable));
  }
  return sections;
}

export type ProductHit = {
  id: string; name: string; imageUrl: string | null; fromCents: number;
  storeSlug: string; storeName: string; storeId: string;
};

/** Produtos cujo nome combina, ignorando acentos e maiúsculas. */
export async function searchProducts(cityId: string, query: string): Promise<ProductHit[]> {
  const rows = await sql<{ id: string }[]>`
    select p.id
    from products p
    join stores s on s.id = p.store_id
    where s.city_id = ${cityId}
      and s.status in ('active', 'paused')
      and p.deleted_at is null
      and unaccent(p.name) ilike unaccent(${likePattern(query)})
    order by similarity(p.name, ${query}) desc, p.name
    limit 30`;

  const details = await loadProducts(rows.map((row) => row.id));
  return rows.flatMap((row) => {
    const detail = details.get(row.id);
    return detail
      ? [{
          id: detail.id, name: detail.name, imageUrl: detail.imageUrl,
          fromCents: startingPriceCents(detail.priceCents, detail.groups),
          storeSlug: detail.storeSlug, storeName: detail.storeName, storeId: detail.storeId,
        }]
      : [];
  });
}

export type PublicReview = {
  id: string; rating: number; comment: string | null; reply: string | null;
  customerFirstName: string; createdAt: Date;
};

export async function listReviews(storeId: string, limit = 10): Promise<PublicReview[]> {
  const rows = await sql<{ id: string; rating: number; comment: string | null; reply: string | null; first_name: string; created_at: Date }[]>`
    select r.id, r.rating, r.comment, r.reply, split_part(p.full_name, ' ', 1) as first_name, r.created_at
    from reviews r
    join profiles p on p.id = r.customer_id
    where r.store_id = ${storeId} and r.hidden_at is null
    order by r.created_at desc
    limit ${limit}`;
  return rows.map((row) => ({
    id: row.id, rating: row.rating, comment: row.comment, reply: row.reply,
    customerFirstName: row.first_name, createdAt: row.created_at,
  }));
}

export async function listDeliveryAreas(storeId: string) {
  return sql<{ name: string; is_rural: boolean; delivery_fee_cents: number; min_minutes: number; max_minutes: number }[]>`
    select n.name, n.is_rural, a.delivery_fee_cents, a.min_minutes, a.max_minutes
    from store_delivery_areas a
    join neighborhoods n on n.id = a.neighborhood_id
    where a.store_id = ${storeId}
    order by n.is_rural, a.delivery_fee_cents, n.name`;
}
