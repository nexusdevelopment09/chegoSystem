import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatCents } from "@/lib/format";
import { smallVariant } from "@/lib/image-url";
import { estimateMinutes, type StoreSummary } from "@/lib/stores/queries";

/** "★ 4,6 (23)", ou "Nova" para lojas com menos de 5 avaliações. */
export function Rating({ avg, count }: { avg: number | null; count: number }) {
  if (count < 5 || avg === null) {
    return <span className="rounded-full bg-peach px-2 py-0.5 text-xs font-bold text-brand-darker">Nova</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 font-semibold" aria-label={`Nota ${avg.toFixed(1).replace(".", ",")} de 5, com ${count} avaliações`}>
      <Icon name="star" size={14} className="text-brand-dark" /> {avg.toFixed(1).replace(".", ",")}
      <span className="font-normal text-coffee-soft">({count})</span>
    </span>
  );
}

/** Quanto custa a entrega para este cliente, por extenso. */
export function deliveryText(store: StoreSummary, neighborhoodName: string | null): string {
  if (!store.offersDelivery) return "Só retirada";
  if (store.area) return store.area.feeCents === 0 ? "Entrega grátis" : `Entrega ${formatCents(store.area.feeCents)}`;
  if (neighborhoodName) return `Não entrega em ${neighborhoodName}`;
  return store.minFeeCents === null ? "Só retirada" : `Entrega a partir de ${formatCents(store.minFeeCents)}`;
}

export function StoreLogo({ store, size }: { store: Pick<StoreSummary, "logoUrl" | "name">; size: number }) {
  return store.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={size <= 64 ? smallVariant(store.logoUrl) : store.logoUrl} srcSet={`${smallVariant(store.logoUrl)} 192w, ${store.logoUrl} 400w`} sizes={`${size}px`}
      alt="" width={size} height={size} loading="lazy" decoding="async" className="shrink-0 rounded-full bg-peach" />
  ) : (
    <div className="shrink-0 rounded-full bg-peach" style={{ width: size, height: size }} />
  );
}

export function StoreCard({ store, neighborhoodName }: { store: StoreSummary; neighborhoodName: string | null }) {
  const open = store.availability.state === "open";

  return (
    <Link
      href={`/loja/${store.slug}`}
      data-testid="store-card"
      className={`group flex h-full items-center gap-3 rounded-card bg-white p-3 shadow-sm ring-1 ring-peach transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand ${open ? "" : "grayscale"}`}
    >
      <StoreLogo store={store} size={64} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-display text-lg font-semibold leading-tight">{store.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-coffee-soft">
          <Rating avg={store.ratingAvg} count={store.ratingCount} />
          <span>· {store.categoryName}</span>
        </p>
        <p className="mt-0.5 text-sm text-coffee-soft">
          {open ? (
            <>
              {estimateMinutes(store)} · {deliveryText(store, neighborhoodName)}
              {store.busyExtraMinutes > 0 && <span className="font-semibold text-brand-darker"> · Movimento alto</span>}
            </>
          ) : (
            <span className="font-semibold text-coffee">
              {store.availability.label}
              {store.acceptsScheduled && " · Aceita agendamento"}
            </span>
          )}
        </p>
      </div>
      <Icon name="chevronRight" size={20} className="shrink-0 text-coffee-soft/60 transition group-hover:translate-x-0.5 group-hover:text-brand-dark" />
    </Link>
  );
}

export function StoreList({ stores, neighborhoodName, empty }: { stores: StoreSummary[]; neighborhoodName: string | null; empty: string }) {
  if (stores.length === 0) {
    return <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">{empty}</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {stores.map((store) => (
        <li key={store.id}>
          <StoreCard store={store} neighborhoodName={neighborhoodName} />
        </li>
      ))}
    </ul>
  );
}

export function StoreListSkeleton() {
  return (
    <ul className="grid animate-pulse gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Carregando lojas">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="h-[88px] rounded-card bg-peach" />
      ))}
    </ul>
  );
}

/**
 * Cartão grande, com a foto de capa da loja: para as vitrines principais da página
 * inicial. Só mostra o que existe no cadastro (nota, tempo, taxa); nada é inventado.
 */
export function StoreCoverCard({ store, neighborhoodName, priority = false }: { store: StoreSummary; neighborhoodName: string | null; priority?: boolean }) {
  const open = store.availability.state === "open";
  const delivery = deliveryText(store, neighborhoodName);
  const freeDelivery = open && store.offersDelivery && store.area?.feeCents === 0;

  return (
    <Link
      href={`/loja/${store.slug}`}
      data-testid="store-card"
      className="group flex h-full flex-col overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-peach transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand"
    >
      {/* A capa é 3:1 (1200x400): mostrada no mesmo formato, nada das laterais é cortado. */}
      <div className="relative aspect-[3/1] w-full bg-peach">
        {store.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={smallVariant(store.coverUrl)}
            srcSet={`${smallVariant(store.coverUrl)} 600w, ${store.coverUrl} 1200w`}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 340px"
            alt=""
            width={600}
            height={200}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className={`size-full object-cover transition duration-300 group-hover:scale-[1.03] ${open ? "" : "grayscale"}`}
          />
        )}
        {freeDelivery && (
          <span className="absolute left-3 top-3 rounded-full bg-success px-2.5 py-1 text-xs font-bold text-white shadow-sm">Entrega grátis</span>
        )}
        {!open && (
          <span className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-full bg-coffee/85 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
            {store.availability.label}
            {store.acceptsScheduled && " · Aceita agendamento"}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-start gap-3 p-3">
        {/* Por cima da capa: sem o z-10, a capa (posicionada) seria pintada sobre a logo e a cortaria. */}
        <div className="relative z-10 -mt-9 shrink-0 rounded-full bg-white p-0.5 shadow-sm">
          <StoreLogo store={store} size={52} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 font-display text-lg font-semibold leading-tight">{store.name}</p>
            <span className="shrink-0 text-sm"><Rating avg={store.ratingAvg} count={store.ratingCount} /></span>
          </div>
          <p className="text-sm text-coffee-soft">{store.categoryName}</p>
          {open && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-coffee-soft">
              <span className="inline-flex items-center gap-1"><Icon name="clock" size={15} /> {estimateMinutes(store)}</span>
              <span className={freeDelivery ? "font-semibold text-success" : ""}>{delivery}</span>
              {store.busyExtraMinutes > 0 && <span className="font-semibold text-brand-darker">Movimento alto</span>}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Grade de cartões com capa: uma coluna no celular, duas no tablet, três no computador. */
export function StoreGrid({ stores, neighborhoodName, empty }: { stores: StoreSummary[]; neighborhoodName: string | null; empty: string }) {
  if (stores.length === 0) {
    return <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">{empty}</p>;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stores.map((store, index) => (
        <li key={store.id}>
          <StoreCoverCard store={store} neighborhoodName={neighborhoodName} priority={index < 2} />
        </li>
      ))}
    </ul>
  );
}

export function StoreGridSkeleton() {
  return (
    <ul className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Carregando lojas">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="h-64 rounded-card bg-peach" />
      ))}
    </ul>
  );
}
