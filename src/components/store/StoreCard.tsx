import Link from "next/link";
import { formatCents } from "@/lib/format";
import { estimateMinutes, type StoreSummary } from "@/lib/stores/queries";

/** "★ 4,6 (23)", ou "Nova" para lojas com menos de 5 avaliações. */
export function Rating({ avg, count }: { avg: number | null; count: number }) {
  if (count < 5 || avg === null) {
    return <span className="rounded-full bg-peach px-2 py-0.5 text-xs font-bold text-brand-darker">Nova</span>;
  }
  return (
    <span className="font-semibold" aria-label={`Nota ${avg.toFixed(1).replace(".", ",")} de 5, com ${count} avaliações`}>
      <span aria-hidden="true" className="text-brand-dark">★</span> {avg.toFixed(1).replace(".", ",")}{" "}
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
    <img src={store.logoUrl} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-full bg-peach" />
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
      className={`flex items-center gap-3 rounded-card bg-white p-3 shadow-sm ring-1 ring-peach transition hover:ring-brand ${open ? "" : "grayscale"}`}
    >
      <StoreLogo store={store} size={64} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold leading-tight">{store.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-coffee-soft">
          <Rating avg={store.ratingAvg} count={store.ratingCount} />
          <span>· {store.categoryName}</span>
        </p>
        <p className="text-sm text-coffee-soft">
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
