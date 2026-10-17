import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FilterChips } from "@/components/store/FilterChips";
import { StoreGrid, StoreGridSkeleton } from "@/components/store/StoreCard";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { getShoppingContext } from "@/lib/shopping-context";
import { applyStoreFilters } from "@/lib/stores/filters";
import { listStores } from "@/lib/stores/queries";

export const metadata: Metadata = { title: "Categoria" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default function CategoryPage(props: Props) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-10">
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

  const [category] = await sql<{ name: string }[]>`select name from categories where slug = ${slug} and active`;
  if (!category) notFound();

  const stores = await listStores(
    { cityId: context.city.id, neighborhoodId: context.neighborhood?.id, categorySlug: slug },
    await now(),
  );

  return (
    <>
      <h1 className="text-3xl">{category.name}</h1>
      <FilterChips basePath={`/categoria/${slug}`} params={filters} />
      <StoreGrid
        stores={applyStoreFilters(stores, filters)}
        neighborhoodName={context.neighborhood?.name ?? null}
        empty="Nenhuma loja por aqui com esses filtros."
      />
    </>
  );
}
