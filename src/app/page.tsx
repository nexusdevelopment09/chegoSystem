import { existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SearchBox } from "@/components/store/SearchBox";
import { WideImage } from "@/components/ui/WideImage";
import { StoreList, StoreListSkeleton } from "@/components/store/StoreCard";
import { getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { CATEGORY_EMOJI } from "@/lib/labels";
import { STORAGE_DIR } from "@/lib/storage-dir";
import { getShoppingContext } from "@/lib/shopping-context";
import { listStores, type StoreSummary } from "@/lib/stores/queries";

export default async function Home() {
  const context = await getShoppingContext();
  if (!context.city || context.firstVisit) redirect("/boas-vindas");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-10">
        <SearchBox />
        <Suspense fallback={<StoreListSkeleton />}>
          <HomeContent />
        </Suspense>
      </main>
      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 py-6 text-center text-sm text-coffee-soft">
        <span>Chegô · Pediu, Chegô.</span>
        <Link href="/quero-vender" className="font-semibold text-brand-dark underline">Quero vender no Chegô</Link>
        <Link href="/quero-entregar" className="font-semibold text-brand-dark underline">Quero entregar</Link>
        <Link href="/termos/uso" className="underline">Termos</Link>
        <Link href="/termos/privacidade" className="underline">Privacidade</Link>
        <Link href="/ajuda" className="underline">Ajuda</Link>
      </footer>
    </>
  );
}

function Shelf({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-2xl">
        {title}
        {note && <span className="font-sans text-sm font-normal text-coffee-soft">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

async function HomeContent() {
  const context = await getShoppingContext();
  if (!context.city || context.firstVisit) redirect("/boas-vindas");

  if (context.city.maintenance) {
    return (
      <div role="status" data-testid="maintenance" className="rounded-card bg-white p-8 text-center ring-1 ring-peach">
        <p className="text-2xl font-semibold">Estamos arrumando a casa em {context.city.name}.</p>
        <p className="text-coffee-soft">O Chegô está em manutenção nesta cidade. Volta já já que a gente abre de novo.</p>
      </div>
    );
  }

  const at = await now();
  const profile = await getCurrentProfile();
  const hoodName = context.neighborhood?.name ?? null;

  const [stores, categories, banners, recentStoreIds] = await Promise.all([
    listStores({ cityId: context.city.id, neighborhoodId: context.neighborhood?.id }, at),
    sql<{ slug: string; name: string; icon: string }[]>`
      select c.slug, c.name, c.icon from categories c
      where c.active and exists (
        select 1 from stores s where s.category_id = c.id and s.city_id = ${context.city.id} and s.status in ('active', 'paused'))
      order by c.sort_order`,
    sql<{ id: string; title: string; image_url: string; link_url: string | null }[]>`
      select id, title, image_url, link_url from banners
      where active and starts_at <= ${at} and (ends_at is null or ends_at > ${at})
        and (city_id is null or city_id = ${context.city.id})
      order by sort_order`,
    profile
      ? sql<{ store_id: string }[]>`
          select store_id from orders
          where customer_id = ${profile.id} and paid_at is not null
          group by store_id order by max(created_at) desc limit 4`
      : Promise.resolve([]),
  ]);

  const open = stores.filter((store) => store.availability.state === "open");
  const featured = stores.filter((store) => store.featured);
  const again = recentStoreIds.flatMap(({ store_id }) => stores.find((store) => store.id === store_id) ?? []);
  const newest = [...stores].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 4);
  const closed = stores.filter((store) => store.availability.state !== "open");

  return (
    <>
      <p className="-mt-3 text-sm text-coffee-soft">
        Entregar em{" "}
        <Link href="/boas-vindas?onde=1" className="font-bold text-brand-dark underline" data-testid="current-location">
          {hoodName ?? "escolher bairro"}, {context.city.name}
        </Link>
      </p>

      <nav aria-label="Categorias" className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {categories.map((category) => (
          <Link key={category.slug} href={`/categoria/${category.slug}`} className="flex w-20 shrink-0 flex-col items-center gap-1 text-center text-xs font-semibold">
            {existsSync(join(STORAGE_DIR, "categories", `${category.slug}.webp`)) ? (
              // Imagem do segmento (240px, poucos KB). <img> comum: o arquivo já está no tamanho certo.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/files/categories/${category.slug}.webp`} alt="" width={64} height={64} decoding="async" className="size-16 rounded-3xl bg-peach" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-3xl bg-peach text-3xl" aria-hidden="true">
                {CATEGORY_EMOJI[category.icon] ?? "🛍️"}
              </span>
            )}
            {category.name}
          </Link>
        ))}
      </nav>

      {banners.length > 0 && (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4" aria-label="Promoções" role="region">
          {banners.map((banner) => {
            const image = <WideImage url={banner.image_url} alt={banner.title} width={1200} height={500} priority={banner.id === banners[0].id} className="aspect-[12/5] w-full rounded-card" />;
            return (
              <div key={banner.id} className="w-[85%] shrink-0 snap-center sm:w-[420px]">
                {banner.link_url ? <Link href={banner.link_url}>{image}</Link> : image}
              </div>
            );
          })}
        </div>
      )}

      {featured.length > 0 && (
        <Shelf title="Destaques" note="Lojas com destaque pago">
          <StoreList stores={featured} neighborhoodName={hoodName} empty="" />
        </Shelf>
      )}

      {again.length > 0 && (
        <Shelf title="Pedir de novo">
          <StoreList stores={again as StoreSummary[]} neighborhoodName={hoodName} empty="" />
        </Shelf>
      )}

      <Shelf title="Abertas agora">
        <StoreList stores={open} neighborhoodName={hoodName} empty="Eita, está tudo fechado agora. Dá uma olhada nas lojas abaixo e agende seu pedido." />
      </Shelf>

      <Shelf title="Novidades na cidade">
        <StoreList stores={newest} neighborhoodName={hoodName} empty="Nenhuma loja por aqui ainda." />
      </Shelf>

      {closed.length > 0 && (
        <Shelf title="Fechadas no momento">
          <StoreList stores={closed} neighborhoodName={hoodName} empty="" />
        </Shelf>
      )}
    </>
  );
}
