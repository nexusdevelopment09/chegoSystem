import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ProductShelf } from "@/components/catalog/ProductShelf";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { chipClass, FilterChips, linkWith } from "@/components/store/FilterChips";
import { StoreGrid, StoreGridSkeleton } from "@/components/store/StoreCard";
import { HScroller } from "@/components/ui/HScroller";
import { categoryProducts, homeShowcases, offerStoreIds } from "@/lib/catalog/showcase";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { getShoppingContext } from "@/lib/shopping-context";
import { applyStoreFilters } from "@/lib/stores/filters";
import { listStores } from "@/lib/stores/queries";
import { liveCampaigns, recordImpressions } from "@/lib/ads/campaigns";

export const metadata: Metadata = { title: "Categoria" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** Chip especial, antes das subcategorias, quando há produtos em oferta no segmento. */
const OFFERS = "ofertas";

export default function CategoryPage(props: Props) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pb-10">
        <Suspense fallback={<StoreGridSkeleton />}>
          <CategoryContent {...props} />
        </Suspense>
      </main>
    </>
  );
}

async function CategoryContent({ params, searchParams }: Props) {
  const [{ slug }, filters, context] = await Promise.all([params, searchParams, getShoppingContext()]);
  if (!context.city) redirect("/boas-vindas");

  const [category] = await sql<{ id: string; name: string }[]>`select id, name from categories where slug = ${slug} and active`;
  if (!category) notFound();

  const at = await now();
  const stores = await listStores({ cityId: context.city.id, neighborhoodId: context.neighborhood?.id, categorySlug: slug }, at);
  const hoodName = context.neighborhood?.name ?? null;

  if (stores.length === 0) {
    return (
      <>
        <h1 className="text-3xl">{category.name}</h1>
        <div role="status" data-testid="category-empty" className="rounded-card bg-white p-8 text-center ring-1 ring-peach">
          <p className="text-xl font-semibold">Ainda não tem lojas de {category.name} em {context.city.name}.</p>
          <p className="mt-1 text-coffee-soft">Estamos chamando as lojas da cidade. Tem uma loja desse tipo?</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/quero-vender" className="inline-flex min-h-11 items-center rounded-full bg-brand-dark px-5 font-bold text-white">Quero vender no Chegô</Link>
            <Link href="/" className="inline-flex min-h-11 items-center rounded-full px-5 font-bold text-brand-dark ring-1 ring-peach">Ver outras categorias</Link>
          </div>
        </div>
      </>
    );
  }

  const storeIds = stores.map((store) => store.id);
  const priorityIds = stores.filter((store) => store.availability.state === "open" && (!context.neighborhood || store.area)).map((store) => store.id);
  // Só as subcategorias que têm loja ou produto à venda nesta cidade.
  const [subcategories, offerStores] = await Promise.all([
    sql<{ id: string; slug: string; name: string; store_ids: string[] }[]>`
      select sc.id, sc.slug, sc.name,
             array(
               select ss.store_id from store_subcategories ss where ss.subcategory_id = sc.id and ss.store_id = any(${storeIds}::uuid[])
               union
               select p.store_id from products p
               where p.subcategory_id = sc.id and p.store_id = any(${storeIds}::uuid[]) and p.deleted_at is null and p.available
             ) as store_ids
      from subcategories sc
      where sc.category_id = ${category.id} and sc.active
      order by sc.sort_order, sc.name`.then((rows) => rows.filter((row) => row.store_ids.length > 0)),
    offerStoreIds(storeIds, at),
  ]);

  const selected = filters.sub === OFFERS ? OFFERS : subcategories.find((sub) => sub.slug === filters.sub) ?? null;
  const inSelection = selected === null ? stores
    : selected === OFFERS ? stores.filter((store) => offerStores.has(store.id))
    : stores.filter((store) => selected.store_ids.includes(store.id));
  // Sem chip escolhido: as vitrines do segmento (ofertas, mais pedidos e combos). Com chip: os produtos dele.
  const [products, showcases] = await Promise.all([
    selected === null ? [] : categoryProducts({
      storeIds: inSelection.map((store) => store.id), priorityIds,
      subcategoryId: selected === OFFERS ? null : selected.id, offersOnly: selected === OFFERS, at,
    }),
    selected === null ? homeShowcases(storeIds, priorityIds, at) : null,
  ]);
  const result = applyStoreFilters(inSelection, filters, { offerStoreIds: offerStores });
  // Destaque pago dentro da categoria: primeiro da lista, com o selo "Patrocinado".
  const categoryCampaigns = (await liveCampaigns({ cityId: context.city.id, at, placements: ["categoria"], categoryId: category.id }))
    .filter((item) => result.some((store) => store.id === item.storeId));
  const categoryMap = new Map<string, string | null>(categoryCampaigns.map((item) => [item.storeId, item.campaignId]));
  const sponsoredFirst = [
    ...categoryCampaigns.map((item) => result.find((store) => store.id === item.storeId)!),
    ...result.filter((store) => !categoryMap.has(store.id)),
  ];
  await recordImpressions(categoryCampaigns.map((item) => item.campaignId), at);
  const basePath = `/categoria/${slug}`;
  const subLink = (value: string | null) => linkWith(basePath, filters, (next) => (value ? next.set("sub", value) : next.delete("sub")));
  const selectedName = selected === OFFERS ? "Ofertas" : selected?.name ?? null;

  return (
    <>
      <header>
        <h1 className="text-3xl">{category.name}</h1>
        <p className="text-coffee-soft">
          {stores.length === 1 ? "1 loja" : `${stores.length} lojas`} em {context.city.name}
        </p>
      </header>

      {(subcategories.length > 0 || offerStores.size > 0) && (
        <nav aria-label={`Tipos de ${category.name}`} data-testid="subcategory-chips">
          <HScroller key={filters.sub ?? "todos"} label={`Tipos de ${category.name}`} listClassName="gap-2" compact>
            <li className="shrink-0">
              <Link href={subLink(null)} scroll={false} aria-current={selected === null ? "true" : undefined} className={chipClass(selected === null)}>
                {slug === "bebidas" || slug === "farmacia" ? "Todas" : "Todos"}
              </Link>
            </li>
            {offerStores.size > 0 && (
              <li className="shrink-0">
                <Link href={subLink(OFFERS)} scroll={false} aria-current={selected === OFFERS ? "true" : undefined} className={chipClass(selected === OFFERS)}>
                  Ofertas
                </Link>
              </li>
            )}
            {subcategories.map((sub) => (
              <li key={sub.id} className="shrink-0">
                <Link href={subLink(sub.slug)} scroll={false} aria-current={selected !== OFFERS && selected?.id === sub.id ? "true" : undefined}
                  className={chipClass(selected !== OFFERS && selected?.id === sub.id)}>
                  {sub.name}
                </Link>
              </li>
            ))}
          </HScroller>
        </nav>
      )}

      <FilterChips basePath={basePath} params={filters} keys={offerStores.size > 0 ? undefined : ["aberto", "gratis", "retirada"]} />

      {slug === "farmacia" && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-sm font-semibold">
          Medicamentos com receita e produtos controlados não são vendidos pelo app. As categorias ajudam a encontrar produtos e não substituem a orientação de um profissional de saúde.
        </p>
      )}

      {showcases && (
        <>
          <ProductShelf title={`Ofertas em ${category.name}`} products={showcases.offers} badge="oferta" showStore testId="category-offers" />
          <ProductShelf title={`Mais pedidos em ${category.name}`} note="nos últimos 30 dias" products={showcases.popular} badge="mais-pedido" showStore testId="category-popular" />
          <ProductShelf title="Combos que valem a pena" products={showcases.combos} showStore testId="category-combos" />
        </>
      )}

      {selectedName && (
        <ProductShelf title={selectedName} note={`produtos em ${category.name.toLowerCase()}`} products={products} badge={selected === OFFERS ? "oferta" : undefined}
          showStore testId="category-products" />
      )}

      <section>
        <h2 className="mb-3 text-xl sm:text-2xl">{selectedName ? `Lojas com ${selectedName.toLowerCase()}` : "Lojas"}</h2>
        {result.length === 0 ? (
          <div role="status" className="rounded-card bg-white p-6 text-center ring-1 ring-peach">
            <p className="font-semibold">Nenhuma loja por aqui com esses filtros.</p>
            <Link href={basePath} scroll={false} className="mt-2 inline-flex min-h-11 items-center font-bold text-brand-dark hover:underline">Limpar filtros</Link>
          </div>
        ) : (
          <StoreGrid stores={sponsoredFirst} neighborhoodName={hoodName} empty="" sponsored={categoryMap} />
        )}
      </section>
    </>
  );
}
