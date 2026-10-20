import "server-only";
import { loadProducts } from "@/lib/catalog/queries";
import { sql } from "@/lib/db";
import { menuProduct, type MenuProduct } from "@/lib/stores/queries";
import { DAY_MS } from "@/lib/time";

// Vitrines de produtos (início, loja, categoria). Tudo sai de dados reais: destaque
// marcado pela loja, pedidos concluídos, preço "de" cadastrado e data de cadastro.
// Nada de popularidade ou desconto inventado: vitrine sem dados não aparece.

export type ShowcaseProduct = MenuProduct & { storeId: string; storeSlug: string; storeName: string };

/** Pedidos que contam como venda de verdade para "mais pedidos". */
const COMPLETED = sql`('delivered', 'picked_up', 'partially_refunded')`;
/** Janela de "mais pedidos". */
const POPULAR_DAYS = 30;
/** Um produto só é "mais pedido" com pelo menos este número de pedidos na janela. */
const POPULAR_MIN_ORDERS = 2;
/** Produto novo: cadastrado nos últimos 30 dias, e não junto com a abertura da loja. */
const NEW_DAYS = 30;

/** Carrega os produtos na ordem dos ids, só os que podem ser pedidos agora ou mais tarde. */
async function showcase(ids: string[], at: Date, limit: number): Promise<ShowcaseProduct[]> {
  const details = await loadProducts(ids);
  const result: ShowcaseProduct[] = [];
  for (const id of ids) {
    const detail = details.get(id);
    if (!detail) continue;
    const product = menuProduct(detail, at);
    // Esgotado ou desativado não entra em vitrine; fora do horário entra, com o aviso.
    if (!product.status.orderable && product.status.reason === "sold_out") continue;
    result.push({ ...product, storeId: detail.storeId, storeSlug: detail.storeSlug, storeName: detail.storeName });
    if (result.length >= limit) break;
  }
  return result;
}

const since = (at: Date, days: number) => new Date(at.getTime() - days * DAY_MS);

/** Mais pedidos entre estas lojas (pedidos concluídos nos últimos 30 dias). */
async function popularIds(storeIds: string[], at: Date, limit: number) {
  if (storeIds.length === 0) return [];
  const rows = await sql<{ product_id: string }[]>`
    select i.product_id
    from order_items i join orders o on o.id = i.order_id
    join products p on p.id = i.product_id and p.deleted_at is null and p.available
    where o.store_id = any(${storeIds}::uuid[]) and o.status in ${COMPLETED}
      and o.completed_at >= ${since(at, POPULAR_DAYS)} and i.removed_at is null
    group by i.product_id
    having count(distinct o.id) >= ${POPULAR_MIN_ORDERS}
    order by count(distinct o.id) desc, i.product_id
    limit ${limit * 2}`;
  return rows.map((row) => row.product_id);
}

async function offerIds(storeIds: string[], limit: number) {
  if (storeIds.length === 0) return [];
  const rows = await sql<{ id: string }[]>`
    select id from products
    where store_id = any(${storeIds}::uuid[]) and deleted_at is null and available
      and compare_at_price_cents > price_cents
    order by (compare_at_price_cents - price_cents)::float / compare_at_price_cents desc, name
    limit ${limit * 2}`;
  return rows.map((row) => row.id);
}

/** Põe na frente os produtos das lojas prioritárias (abertas e que entregam no bairro), sem mudar a ordem dentro de cada grupo. */
function prioritize<T extends { storeId: string }>(items: T[], priority: Set<string>) {
  return [...items.filter((item) => priority.has(item.storeId)), ...items.filter((item) => !priority.has(item.storeId))];
}

/** Lojas com algum produto em oferta ou cupom próprio válido agora (filtro "Com ofertas"). */
export async function offerStoreIds(storeIds: string[], at: Date): Promise<Set<string>> {
  if (storeIds.length === 0) return new Set();
  const rows = await sql<{ store_id: string }[]>`
    select distinct store_id from products
    where store_id = any(${storeIds}::uuid[]) and deleted_at is null and available and compare_at_price_cents > price_cents
    union
    select distinct unnest(store_ids) from coupons
    where active and created_by_store_id is not null and cardinality(store_ids) > 0
      and (starts_at is null or starts_at <= ${at}) and (expires_at is null or expires_at > ${at})
      and (max_uses is null or uses_count < max_uses) and owner_profile_id is null`;
  const visible = new Set(storeIds);
  return new Set(rows.map((row) => row.store_id).filter((id) => visible.has(id)));
}

/** Lojas com mais pedidos concluídos nos últimos 30 dias (pelo menos 3), da mais pedida para a menos. */
export async function popularStoreIds(storeIds: string[], at: Date, limit = 4): Promise<string[]> {
  if (storeIds.length === 0) return [];
  const rows = await sql<{ store_id: string }[]>`
    select o.store_id from orders o
    where o.store_id = any(${storeIds}::uuid[]) and o.status in ${COMPLETED} and o.completed_at >= ${since(at, POPULAR_DAYS)}
    group by o.store_id having count(*) >= 3
    order by count(*) desc limit ${limit}`;
  return rows.map((row) => row.store_id);
}

export type HomeShowcases = {
  popular: ShowcaseProduct[];
  offers: ShowcaseProduct[];
  combos: ShowcaseProduct[];
  /** Lojas com mais pedidos concluídos nos últimos 30 dias, da mais pedida para a menos. */
  popularStoreIds: string[];
};

/**
 * Vitrines do início: storeIds são as lojas que o cliente pode ver na cidade; as de
 * priorityIds (abertas e que entregam no bairro dele) vêm primeiro em cada vitrine.
 */
export async function homeShowcases(storeIds: string[], priorityIds: string[], at: Date): Promise<HomeShowcases> {
  if (storeIds.length === 0) return { popular: [], offers: [], combos: [], popularStoreIds: [] };
  const [popular, offers, combos, stores] = await Promise.all([
    popularIds(storeIds, at, 12),
    offerIds(storeIds, 12),
    sql<{ id: string }[]>`
      select p.id from products p left join product_sections sec on sec.id = p.section_id
      where p.store_id = any(${storeIds}::uuid[]) and p.deleted_at is null and p.available
        and (unaccent(sec.name) ilike '%combo%' or unaccent(p.name) ilike 'combo%')
      order by p.featured desc, p.sort_order, p.name
      limit 24`,
    popularStoreIds(storeIds, at),
  ]);
  const [popularList, offerList, comboList] = await Promise.all([
    showcase(popular, at, 12), showcase(offers, at, 12), showcase(combos.map((row) => row.id), at, 24),
  ]);
  const priority = new Set(priorityIds);
  return {
    popular: prioritize(popularList, priority),
    offers: prioritize(offerList, priority),
    // Até dois combos por loja, para a vitrine não virar o cardápio de uma loja só.
    combos: prioritize(comboList, priority).filter((item, index, list) => list.slice(0, index).filter((other) => other.storeId === item.storeId).length < 2).slice(0, 12),
    popularStoreIds: stores,
  };
}

export type StoreShowcases = {
  featured: ShowcaseProduct[];
  popular: ShowcaseProduct[];
  offers: ShowcaseProduct[];
  newest: ShowcaseProduct[];
  /** O que este cliente já pediu nesta loja (vazio para quem não entrou ou nunca pediu). */
  again: ShowcaseProduct[];
};

/** Vitrines do topo da página da loja. */
export async function storeShowcases(storeId: string, at: Date, customerId: string | null): Promise<StoreShowcases> {
  const [featured, popular, offers, newest, again] = await Promise.all([
    sql<{ id: string }[]>`
      select p.id from products p left join product_sections sec on sec.id = p.section_id
      where p.store_id = ${storeId} and p.featured and p.deleted_at is null and p.available
      order by sec.sort_order nulls last, p.sort_order limit 12`,
    popularIds([storeId], at, 10),
    offerIds([storeId], 12),
    sql<{ id: string }[]>`
      select p.id from products p join stores s on s.id = p.store_id
      where p.store_id = ${storeId} and p.deleted_at is null and p.available
        and p.created_at >= ${since(at, NEW_DAYS)} and p.created_at <= ${at} and p.created_at > s.created_at + interval '7 days'
      order by p.created_at desc limit 12`,
    customerId
      ? sql<{ product_id: string }[]>`
          select i.product_id from order_items i join orders o on o.id = i.order_id
          where o.store_id = ${storeId} and o.customer_id = ${customerId} and o.status in ${COMPLETED} and i.removed_at is null
          group by i.product_id order by count(*) desc, max(o.created_at) desc limit 12`
      : Promise.resolve([]),
  ]);
  const [featuredList, popularList, offerList, newestList, againList] = await Promise.all([
    showcase(featured.map((row) => row.id), at, 12),
    showcase(popular, at, 10),
    showcase(offers, at, 12),
    showcase(newest.map((row) => row.id), at, 12),
    showcase(again.map((row) => row.product_id), at, 12),
  ]);
  return { featured: featuredList, popular: popularList, offers: offerList, newest: newestList, again: againList };
}

/**
 * Produtos de uma subcategoria (ou em oferta) entre as lojas visíveis do segmento, para a
 * vitrine da página de categoria.
 */
export async function categoryProducts(input: { storeIds: string[]; priorityIds: string[]; subcategoryId: string | null; offersOnly: boolean; at: Date }): Promise<ShowcaseProduct[]> {
  if (input.storeIds.length === 0 || (!input.subcategoryId && !input.offersOnly)) return [];
  const rows = await sql<{ id: string }[]>`
    select id from products
    where store_id = any(${input.storeIds}::uuid[]) and deleted_at is null and available
      ${input.subcategoryId ? sql`and subcategory_id = ${input.subcategoryId}` : sql``}
      ${input.offersOnly ? sql`and compare_at_price_cents > price_cents` : sql``}
    order by featured desc, name limit 48`;
  return prioritize(await showcase(rows.map((row) => row.id), input.at, 24), new Set(input.priorityIds));
}
