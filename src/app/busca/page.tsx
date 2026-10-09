import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ProductImage } from "@/components/catalog/ProductImage";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FilterChips } from "@/components/store/FilterChips";
import { SearchBox } from "@/components/store/SearchBox";
import { StoreList, StoreListSkeleton } from "@/components/store/StoreCard";
import { now } from "@/lib/clock";
import { formatCents } from "@/lib/format";
import { getShoppingContext } from "@/lib/shopping-context";
import { applyStoreFilters } from "@/lib/stores/filters";
import { listStores, searchProducts } from "@/lib/stores/queries";

export const metadata: Metadata = { title: "Buscar" };

type SearchParams = Promise<Record<string, string | undefined>>;

export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-10">
        <Suspense fallback={<StoreListSkeleton />}>
          <SearchContent searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function SearchContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 60);
  const context = await getShoppingContext();
  if (!context.city) redirect("/boas-vindas");

  const at = await now();
  const hoodName = context.neighborhood?.name ?? null;
  const [stores, products] = await Promise.all([
    listStores({ cityId: context.city.id, neighborhoodId: context.neighborhood?.id, query: query || undefined, categorySlug: params.categoria }, at),
    query.length >= 2 ? searchProducts(context.city.id, query) : Promise.resolve([]),
  ]);
  const filtered = applyStoreFilters(stores, params);
  const nothing = query && filtered.length === 0 && products.length === 0;

  return (
    <>
      <SearchBox initial={query} />
      <FilterChips basePath="/busca" params={params} />

      {nothing ? (
        <div className="rounded-card bg-white p-6 text-center ring-1 ring-peach">
          <p className="text-lg font-semibold">Oxe, não achamos nada com “{query}”.</p>
          <p className="text-coffee-soft">Confere se escreveu certo ou tenta outra palavra, como “pizza” ou “açaí”.</p>
          <Link href="/" className="mt-3 inline-flex min-h-11 items-center font-bold text-brand-dark underline">Ver todas as lojas</Link>
        </div>
      ) : (
        <>
          <section>
            <h1 className="mb-2 text-2xl">{query ? `Lojas com “${query}”` : "Todas as lojas"}</h1>
            <StoreList stores={filtered} neighborhoodName={hoodName} empty="Nenhuma loja com esses filtros." />
          </section>

          {products.length > 0 && (
            <section>
              <h2 className="mb-2 text-2xl">Produtos</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {products.map((product) => (
                  <li key={product.id}>
                    <Link href={`/loja/${product.storeSlug}/produto/${product.id}`} data-testid="product-hit" className="flex items-center gap-3 rounded-card bg-white p-3 shadow-sm ring-1 ring-peach">
                      <ProductImage url={product.imageUrl} alt="" size={64} className="size-16 rounded-2xl" />
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight">{product.name}</p>
                        <p className="text-sm text-coffee-soft">{product.storeName}</p>
                        <p className="font-bold">{formatCents(product.fromCents)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
