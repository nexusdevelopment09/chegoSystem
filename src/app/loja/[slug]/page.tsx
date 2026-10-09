import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductImage } from "@/components/catalog/ProductImage";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CartBar } from "@/components/store/CartBar";
import { deliveryText, Rating, StoreLogo } from "@/components/store/StoreCard";
import { Button } from "@/components/ui/Button";
import { getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { getShoppingContext } from "@/lib/shopping-context";
import { estimateMinutes, getMenu, listDeliveryAreas, listReviews, listStores, type StoreSummary } from "@/lib/stores/queries";
import { formatHour, parseTime, WEEKDAY_NAMES } from "@/lib/time";
import { toggleFavorite } from "../actions";

type Params = Promise<{ slug: string }>;

/** The store, wherever it is: a shared link works even from another city. */
async function findStore(slug: string, neighborhoodId: string | null, at: Date): Promise<StoreSummary | null> {
  const [row] = await sql<{ city_id: string }[]>`
    select s.city_id from stores s join cities c on c.id = s.city_id and c.active
    where s.slug = ${slug} and s.status in ('active', 'paused')`;
  if (!row) return null;
  return (await listStores({ cityId: row.city_id, neighborhoodId, slug }, at))[0] ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const [store] = await sql<{ name: string; description: string }[]>`
    select name, description from stores where slug = ${slug} and status in ('active', 'paused')`;
  if (!store) return { title: "Loja não encontrada" };

  const description = `${store.description} Peça pelo Chegô.`;
  return {
    title: store.name,
    description,
    openGraph: { title: `${store.name} no Chegô`, description, type: "website", locale: "pt_BR", siteName: "Chegô" },
  };
}

export default function StorePage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-6">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando loja" />}>
          <StoreContent params={params} />
        </Suspense>
      </main>
      <CartBar />
    </>
  );
}

async function StoreContent({ params }: { params: Params }) {
  const { slug } = await params;
  const [context, at, profile] = await Promise.all([getShoppingContext(), now(), getCurrentProfile()]);

  const store = await findStore(slug, context.neighborhood?.id ?? null, at);
  if (!store) notFound();

  const [menu, reviews, areas, favorite, host] = await Promise.all([
    getMenu(store.id, at),
    listReviews(store.id, 5),
    listDeliveryAreas(store.id),
    profile
      ? sql`select 1 from favorites where profile_id = ${profile.id} and store_id = ${store.id}`.then((rows) => rows.length > 0)
      : false,
    headers().then((list) => list.get("host") ?? "localhost:3000"),
  ]);

  const open = store.availability.state === "open";
  const hoodName = context.neighborhood?.name ?? null;
  const shareText = encodeURIComponent(`Olha a ${store.name} no Chegô: http://${host}/loja/${store.slug}`);

  return (
    <div className="flex flex-col gap-5">
      {store.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={store.coverUrl} alt="" width={1200} height={400} className="aspect-[3/1] w-full rounded-card object-cover" />
      )}

      <header className="-mt-12 flex flex-col gap-2 px-2">
        <div className="flex items-end justify-between gap-3">
          <div className="rounded-full ring-4 ring-cream">
            <StoreLogo store={store} size={88} />
          </div>
          <div className="flex gap-2">
            <form action={toggleFavorite}>
              <input type="hidden" name="storeId" value={store.id} />
              <input type="hidden" name="slug" value={store.slug} />
              <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm" aria-pressed={favorite}
                aria-label={favorite ? "Tirar dos favoritos" : "Adicionar aos favoritos"}>
                {favorite ? "♥ Favorita" : "♡ Favoritar"}
              </Button>
            </form>
            <a href={`https://wa.me/?text=${shareText}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-full bg-peach px-4 text-sm font-bold text-brand-darker">
              Compartilhar
            </a>
          </div>
        </div>

        <h1 className="text-3xl">{store.name}</h1>
        <p className="text-coffee-soft">{store.description}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Rating avg={store.ratingAvg} count={store.ratingCount} />
          <span>{estimateMinutes(store)}</span>
          <span data-testid="delivery-text">{deliveryText(store, hoodName)}</span>
          {store.minOrderCents > 0 && <span>Pedido mínimo {formatCents(store.minOrderCents)}</span>}
        </p>

        <p data-testid="store-state" className={`self-start rounded-full px-3 py-1 text-sm font-bold ${open ? "bg-success text-white" : "bg-coffee text-peach"}`}>
          {open ? (store.availability.pickupOnly ? "Aberta · hoje só retirada" : "Aberta") : store.availability.label}
        </p>

        {!open && (
          <p className="rounded-2xl bg-peach px-4 py-3 text-sm">
            Eita, essa loja está fechada agora.{" "}
            {store.acceptsScheduled ? "Mas você pode agendar seu pedido." : "Volta mais tarde?"}
          </p>
        )}
        {store.busyExtraMinutes > 0 && open && (
          <p className="rounded-2xl bg-peach px-4 py-3 text-sm font-semibold">
            Movimento alto: os pedidos estão levando cerca de {store.busyExtraMinutes} minutos a mais.
          </p>
        )}
        {store.offersDelivery && hoodName && !store.area && (
          <p className="rounded-2xl bg-peach px-4 py-3 text-sm" data-testid="no-delivery">
            Essa loja ainda não entrega em {hoodName}.{store.offersPickup && " Você pode retirar no balcão."}
          </p>
        )}
        {store.categorySlug === "farmacia" && (
          <p className="rounded-2xl bg-peach px-4 py-3 text-sm font-semibold">
            Medicamentos com receita não são vendidos pelo app.
          </p>
        )}
      </header>

      <nav aria-label="Seções do cardápio" className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-cream px-4 py-2">
        {menu.map((section) => (
          <a key={section.id} href={`#secao-${section.id}`} className="flex min-h-11 shrink-0 items-center rounded-full bg-white px-4 text-sm font-bold ring-1 ring-peach">
            {section.name}
          </a>
        ))}
      </nav>

      {menu.map((section) => (
        <section key={section.id} id={`secao-${section.id}`} className="scroll-mt-16">
          <h2 className="mb-2 text-2xl">{section.name}</h2>
          <ul className="flex flex-col gap-2">
            {section.products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/loja/${store.slug}/produto/${product.id}`}
                  data-testid="menu-product"
                  className={`flex items-center gap-3 rounded-card bg-white p-3 shadow-sm ring-1 ring-peach ${product.status.orderable ? "" : "opacity-60 grayscale"}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">{product.name}</p>
                    {product.description && <p className="line-clamp-2 text-sm text-coffee-soft">{product.description}</p>}
                    <p className="mt-1 font-bold">
                      {product.priceVaries && <span className="text-sm font-normal text-coffee-soft">a partir de </span>}
                      {formatCents(product.fromCents)}
                    </p>
                    {product.status.note && <p className="text-sm font-semibold text-brand-darker">{product.status.note}</p>}
                  </div>
                  <ProductImage url={product.imageUrl} alt="" size={88} className="size-[88px] shrink-0 rounded-2xl" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-2xl">Avaliações</h2>
        {reviews.length === 0 ? (
          <p className="text-coffee-soft">Essa loja ainda não tem avaliações.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-card bg-white p-4 ring-1 ring-peach">
                <p className="text-sm">
                  <span className="font-bold text-brand-dark" aria-label={`${review.rating} de 5 estrelas`}>
                    {"★".repeat(review.rating)}<span className="text-peach">{"★".repeat(5 - review.rating)}</span>
                  </span>{" "}
                  {review.customerFirstName} · <span className="text-coffee-soft">{formatDateTime(review.createdAt)}</span>
                </p>
                {review.comment && <p className="mt-1">{review.comment}</p>}
                {review.reply && (
                  <p className="mt-2 rounded-2xl bg-cream px-3 py-2 text-sm">
                    <strong>Resposta da loja:</strong> {review.reply}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-2xl">Informações</h2>
        <h3 className="font-sans text-sm font-bold uppercase text-coffee-soft">Horários</h3>
        <ul className="mb-3 text-sm">
          {WEEKDAY_NAMES.map((name, weekday) => {
            const shifts = store.shifts.filter((shift) => shift.weekday === weekday).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
            return (
              <li key={name} className="flex justify-between gap-3 border-b border-cream py-1 last:border-0">
                <span className="capitalize">{name}</span>
                <span>
                  {shifts.length === 0
                    ? "Fechada"
                    : shifts.map((shift) => `${formatHour(parseTime(shift.opensAt))} às ${formatHour(parseTime(shift.closesAt))}${shift.pickupOnly ? " (só retirada)" : ""}`).join(" e ")}
                </span>
              </li>
            );
          })}
        </ul>
        <h3 className="font-sans text-sm font-bold uppercase text-coffee-soft">Onde entrega</h3>
        {areas.length === 0 ? (
          <p className="text-sm">Só retirada no balcão.</p>
        ) : (
          <ul className="text-sm">
            {areas.map((area) => (
              <li key={area.name} className="flex justify-between gap-3 border-b border-cream py-1 last:border-0">
                <span>{area.name}{area.is_rural && " (zona rural)"}</span>
                <span>{formatCents(area.delivery_fee_cents)} · {area.min_minutes}–{area.max_minutes} min</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
