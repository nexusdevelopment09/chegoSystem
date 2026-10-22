import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { BannerCarousel } from "@/components/home/BannerCarousel";
import { CategoryNav } from "@/components/home/CategoryNav";
import { CouponBanner } from "@/components/home/CouponBanner";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FilterChips } from "@/components/store/FilterChips";
import { SearchBox } from "@/components/store/SearchBox";
import { StoreGrid, StoreGridSkeleton, StoreList } from "@/components/store/StoreCard";
import { Icon } from "@/components/ui/Icon";
import { getCurrentProfile } from "@/lib/auth/session";
import { offerStoreIds, popularStoreIds } from "@/lib/catalog/showcase";
import { liveCampaigns, recordImpressions } from "@/lib/ads/campaigns";
import { now } from "@/lib/clock";
import { DISMISSED_COUPONS_COOKIE } from "@/lib/coupons/cookie";
import { visibleCoupons } from "@/lib/coupons/visible";
import { sql } from "@/lib/db";
import { getShoppingContext } from "@/lib/shopping-context";
import { applyStoreFilters, hasActiveFilters } from "@/lib/stores/filters";
import { listStores } from "@/lib/stores/queries";
import { DAY_MS } from "@/lib/time";

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const context = await getShoppingContext();
  if (!context.city) redirect("/boas-vindas"); // nenhuma cidade ativa

  return (
    <>
      <SiteHeader>
        {/* Onde a entrega vai chegar: o primeiro passo de qualquer app de delivery. */}
        <Link
          href="/boas-vindas?onde=1"
          className="inline-flex min-h-11 max-w-full shrink-0 items-center gap-2 self-start rounded-full bg-white px-4 text-sm shadow-sm ring-1 ring-peach transition hover:ring-brand md:self-auto"
        >
          <Icon name="pin" size={18} className="shrink-0 text-brand-dark" />
          <span className="shrink-0 text-coffee-soft">Entregar em</span>
          <span className="truncate font-bold text-coffee" data-testid="current-location">
            {context.neighborhood?.name ?? "escolher bairro"}, {context.city.name}
          </span>
          <Icon name="chevronDown" size={16} className="shrink-0 text-brand-dark" />
        </Link>
        <div className="min-w-0 md:max-w-xl md:flex-1">
          <SearchBox />
        </div>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-7 px-4 pb-12 pt-5 sm:gap-9 sm:pt-6">
        <Suspense fallback={<StoreGridSkeleton />}>
          <HomeContent searchParams={searchParams} />
        </Suspense>
      </main>
      <footer className="border-t border-peach/70 bg-white/60">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-5 gap-y-1 px-4 py-6 text-center text-sm text-coffee-soft">
          <span>Chegô · Pediu, Chegô.</span>
          <Link href="/quero-vender" className="font-semibold text-brand-dark underline">Quero vender no Chegô</Link>
          <Link href="/quero-entregar" className="font-semibold text-brand-dark underline">Quero entregar</Link>
          <Link href="/termos/uso" className="underline">Termos</Link>
          <Link href="/termos/privacidade" className="underline">Privacidade</Link>
          <Link href="/ajuda" className="underline">Ajuda</Link>
        </div>
      </footer>
    </>
  );
}

function Shelf({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex flex-wrap items-baseline gap-x-2 text-xl sm:text-2xl">
        {title}
        {note && <span className="font-sans text-sm font-normal text-coffee-soft">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

async function HomeContent({ searchParams }: { searchParams: SearchParams }) {
  const [context, filters] = await Promise.all([getShoppingContext(), searchParams]);
  if (!context.city) return null;

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
    // Todos os segmentos ativos: um segmento ainda sem lojas abre com o convite para vender.
    sql<{ slug: string; name: string }[]>`select c.slug, c.name from categories c where c.active order by c.sort_order`,
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

  const storeIds = stores.map((store) => store.id);
  const dismissed = new Set(((await cookies()).get(DISMISSED_COUPONS_COOKIE)?.value ?? "").split("."));
  const [popular, offerStores, coupons, campaigns] = await Promise.all([
    popularStoreIds(storeIds, at),
    offerStoreIds(storeIds, at),
    visibleCoupons({ cityId: context.city.id, profileId: profile?.id ?? null, at }),
    liveCampaigns({ cityId: context.city.id, at, placements: ["inicio", "promocional", "topo"] }),
  ]);
  const shownCoupons = coupons.filter((coupon) => !dismissed.has(coupon.id));
  const popularStores = popular.flatMap((id) => stores.find((store) => store.id === id) ?? []);

  const filtered = hasActiveFilters(filters) ? applyStoreFilters(stores, filters, { offerStoreIds: offerStores }) : null;
  const closed = stores.filter((store) => store.availability.state !== "open");
  // Anúncios: "Destaques" (página inicial e campanhas promocionais, por prioridade) e as primeiras
  // posições de "Abertas agora". Sempre com o selo "Patrocinado"; a ordem orgânica do resto não muda.
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const highlight = campaigns.filter((item) => item.placement !== "topo" && storeById.has(item.storeId));
  const highlightIds = new Set(highlight.map((item) => item.storeId));
  const featured = [
    ...highlight.filter((item, index) => highlight.findIndex((other) => other.storeId === item.storeId) === index).map((item) => storeById.get(item.storeId)!),
    ...stores.filter((store) => store.featured && !highlightIds.has(store.id)),
  ];
  const featuredMap = new Map<string, string | null>([
    ...stores.filter((store) => store.featured && !highlightIds.has(store.id)).map((store) => [store.id, null] as const),
    ...[...highlight].reverse().map((item) => [item.storeId, item.campaignId] as const),
  ]);
  const top = campaigns.filter((item) => item.placement === "topo" && storeById.get(item.storeId)?.availability.state === "open");
  const topMap = new Map<string, string | null>(top.map((item) => [item.storeId, item.campaignId]));
  const openOrganic = stores.filter((store) => store.availability.state === "open");
  const open = [...top.map((item) => storeById.get(item.storeId)!), ...openOrganic.filter((store) => !topMap.has(store.id))];
  const again = recentStoreIds.flatMap(({ store_id }) => stores.find((store) => store.id === store_id) ?? []);
  // Novidades: só lojas que entraram no Chegô nos últimos 30 dias.
  const newest = stores
    .filter((store) => at.getTime() - store.createdAt.getTime() <= 30 * DAY_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 4);

  if (!filtered) await recordImpressions([...highlight, ...top].map((item) => item.campaignId), at);

  return (
    <>
      <CouponBanner coupons={shownCoupons} />

      <BannerCarousel
        banners={banners.map((banner) => ({ id: banner.id, title: banner.title, imageUrl: banner.image_url, linkUrl: banner.link_url }))}
      />

      {categories.length > 0 && (
        <Shelf title="O que você procura hoje?">
          <CategoryNav categories={categories} />
        </Shelf>
      )}

      <FilterChips basePath="/" params={filters} keys={offerStores.size > 0 ? undefined : ["aberto", "gratis", "retirada"]} />

      {filtered ? (
        <Shelf title="Lojas" note={filtered.length === 1 ? "1 encontrada" : `${filtered.length} encontradas`}>
          <StoreGrid stores={filtered} neighborhoodName={hoodName} empty="Nenhuma loja com esses filtros. Tente tirar algum." />
        </Shelf>
      ) : (
        <>

          {featured.length > 0 && (
            <Shelf title="Destaques" note="Patrocinado">
              <StoreGrid stores={featured} neighborhoodName={hoodName} empty="" sponsored={featuredMap} />
            </Shelf>
          )}

          {popularStores.length > 0 && (
            <Shelf title="Lojas populares" note="mais pedidos nos últimos 30 dias">
              <StoreList stores={popularStores} neighborhoodName={hoodName} empty="" />
            </Shelf>
          )}

          {again.length > 0 && (
            <Shelf title="Pedir de novo">
              <StoreList stores={again} neighborhoodName={hoodName} empty="" />
            </Shelf>
          )}

          <Shelf title="Abertas agora">
            <StoreGrid stores={open} neighborhoodName={hoodName} sponsored={topMap} empty="Eita, está tudo fechado agora. Dá uma olhada nas lojas abaixo e agende seu pedido." />
          </Shelf>

          {newest.length > 0 && (
            <Shelf title="Novidades na cidade">
              <StoreList stores={newest} neighborhoodName={hoodName} empty="" />
            </Shelf>
          )}

          {closed.length > 0 && (
            <Shelf title="Fechadas no momento">
              <StoreList stores={closed} neighborhoodName={hoodName} empty="" />
            </Shelf>
          )}
        </>
      )}
    </>
  );
}
