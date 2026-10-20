import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ProductCard } from "@/components/catalog/ProductShelf";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StoreGridSkeleton } from "@/components/store/StoreCard";
import { CopyButton } from "@/components/ui/CopyButton";
import { Icon } from "@/components/ui/Icon";
import { getCurrentProfile } from "@/lib/auth/session";
import { homeShowcases } from "@/lib/catalog/showcase";
import { now } from "@/lib/clock";
import { visibleCoupons } from "@/lib/coupons/visible";
import { getShoppingContext } from "@/lib/shopping-context";
import { listStores } from "@/lib/stores/queries";

export const metadata: Metadata = { title: "Ofertas e cupons" };

export default function OffersPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-12 pt-4">
        <Suspense fallback={<StoreGridSkeleton />}>
          <Offers />
        </Suspense>
      </main>
    </>
  );
}

async function Offers() {
  const context = await getShoppingContext();
  if (!context.city) redirect("/boas-vindas");
  const [at, profile] = await Promise.all([now(), getCurrentProfile()]);

  const stores = await listStores({ cityId: context.city.id, neighborhoodId: context.neighborhood?.id }, at);
  const priorityIds = stores.filter((store) => store.availability.state === "open" && (!context.neighborhood || store.area)).map((store) => store.id);
  const [coupons, showcases] = await Promise.all([
    visibleCoupons({ cityId: context.city.id, profileId: profile?.id ?? null, at, limit: 20 }),
    homeShowcases(stores.map((store) => store.id), priorityIds, at),
  ]);

  return (
    <>
      <header>
        <h1 className="text-3xl">Ofertas e cupons</h1>
        <p className="text-coffee-soft">Cupons que você pode usar agora e produtos com preço baixado pelas lojas de {context.city.name}.</p>
      </header>

      <section aria-labelledby="cupons">
        <h2 id="cupons" className="mb-3 text-2xl">Cupons</h2>
        {coupons.length === 0 ? (
          <p className="rounded-card bg-white p-4 text-coffee-soft ring-1 ring-peach">Nenhum cupom disponível para você agora. Volte depois!</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coupons.map((coupon) => (
              <li key={coupon.id} data-testid="offer-coupon" className="flex flex-col gap-3 rounded-card bg-white p-4 shadow-sm ring-1 ring-peach">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-peach text-brand-darker"><Icon name="ticket" size={22} /></span>
                  <div className="min-w-0">
                    <p className="font-bold">{coupon.benefit}</p>
                    <p className="text-sm text-coffee-soft">{coupon.description}</p>
                  </div>
                </div>
                {coupon.conditions.length > 0 && <p className="text-xs text-coffee-soft">{coupon.conditions.join(" · ")}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <code className="rounded-lg bg-cream px-3 py-2 font-mono font-bold tracking-wide text-brand-darker">{coupon.code}</code>
                  <CopyButton text={coupon.code} label="Copiar cupom" />
                  {coupon.href !== "/ofertas" && (
                    <Link href={coupon.href} className="inline-flex min-h-11 items-center text-sm font-bold text-brand-dark hover:underline">
                      Ver {coupon.storeName ? "a loja" : "lojas"}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-coffee-soft">Digite o código no fechamento do pedido. O desconto é conferido na hora, com as condições de cada cupom.</p>
      </section>

      <section aria-labelledby="produtos">
        <h2 id="produtos" className="mb-3 text-2xl">Produtos em oferta</h2>
        {showcases.offers.length === 0 ? (
          <div className="rounded-card bg-white p-6 text-center ring-1 ring-peach">
            <p className="font-semibold">Nenhum produto em oferta agora.</p>
            <Link href="/" className="mt-2 inline-flex min-h-11 items-center font-bold text-brand-dark hover:underline">Voltar para o início</Link>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
            {showcases.offers.map((product) => <ProductCard key={product.id} product={product} badge="oferta" showStore fluid />)}
          </ul>
        )}
      </section>
    </>
  );
}
