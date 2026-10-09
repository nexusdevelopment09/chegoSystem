import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StoreList, StoreListSkeleton } from "@/components/store/StoreCard";
import { requireUser } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { withUser } from "@/lib/db";
import { getShoppingContext } from "@/lib/shopping-context";
import { listStores } from "@/lib/stores/queries";

export const metadata: Metadata = { title: "Favoritos" };

export default function FavoritesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-10">
        <h1 className="text-3xl">Favoritos</h1>
        <Suspense fallback={<StoreListSkeleton />}>
          <FavoritesContent />
        </Suspense>
      </main>
    </>
  );
}

async function FavoritesContent() {
  const profile = await requireUser();
  const context = await getShoppingContext();

  const favorites = await withUser(profile.id, (tx) => tx<{ store_id: string }[]>`select store_id from favorites`);
  const stores = context.city && favorites.length > 0
    ? await listStores(
        { cityId: context.city.id, neighborhoodId: context.neighborhood?.id, ids: favorites.map((row) => row.store_id) },
        await now(),
      )
    : [];

  return (
    <StoreList
      stores={stores}
      neighborhoodName={context.neighborhood?.name ?? null}
      empty="Você ainda não tem lojas favoritas. Toque no coração na página da loja."
    />
  );
}
