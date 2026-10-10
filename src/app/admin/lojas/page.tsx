import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { STORE_STATUS_LABELS } from "@/lib/labels";
import { storeAvailability, type Shift } from "@/lib/stores/hours";

export const metadata: Metadata = { title: "Lojas" };

type SearchParams = Promise<{ situacao?: string; q?: string; abertas?: string; cidade?: string }>;

export default function AdminStoresPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Stores searchParams={searchParams} />
    </Suspense>
  );
}

async function Stores({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const { situacao, q, abertas, cidade } = await searchParams;
  // Filtros que vêm do número "Lojas abertas agora" do painel.
  const onlyOpen = abertas === "1";
  const cityId = cidade && /^[0-9a-f-]{36}$/i.test(cidade) ? cidade : null;
  const status = Object.keys(STORE_STATUS_LABELS).includes(situacao ?? "") ? situacao! : null;
  const at = await now();

  const all = await sql<{
    id: string; name: string; status: keyof typeof STORE_STATUS_LABELS; city: string; category: string; commission_rate: string;
    featured: boolean; products: number; overdue: number;
    manual_state: "auto" | "open" | "closed"; paused_until: Date | null; shifts: Shift[];
  }[]>`
    select s.id, s.name, s.status, c.name as city, cat.name as category, sp.commission_rate,
           coalesce(s.featured_until > ${at}, false) as featured,
           (select count(*)::int from products p where p.store_id = s.id and p.deleted_at is null) as products,
           (select count(*)::int from invoices i where i.store_id = s.id and i.status = 'overdue') as overdue,
           s.manual_state, s.paused_until,
           coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text))
                     from store_hours h where h.store_id = s.id), '[]') as shifts
    from stores s
    join cities c on c.id = s.city_id
    join categories cat on cat.id = s.category_id
    join store_private sp on sp.store_id = s.id
    where true
      ${status ? sql`and s.status = ${status}::store_status` : sql``}
      ${cityId ? sql`and s.city_id = ${cityId}` : sql``}
      ${q ? sql`and unaccent(s.name) ilike unaccent(${`%${q.replace(/[\\%_]/g, "\\$&")}%`})` : sql``}
    order by (s.status = 'pending') desc, s.name`;
  const isOpen = (store: (typeof all)[number]) =>
    (store.status === "active" || store.status === "paused") &&
    storeAvailability({ status: store.status, manualState: store.manual_state, pausedUntil: store.paused_until, shifts: store.shifts, closures: [] }, at).state === "open";
  const stores = onlyOpen ? all.filter(isOpen) : all;

  const chip = (value: string | null, label: string) => (
    <Link key={label} href={value ? `/admin/lojas?situacao=${value}` : "/admin/lojas"} aria-current={status === value ? "true" : undefined}
      className={buttonClass(status === value ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>{label}</Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Lojas</h1>
      <div className="flex flex-wrap gap-2">
        {chip(null, "Todas")}
        {Object.entries(STORE_STATUS_LABELS).map(([value, label]) => chip(value, label))}
      </div>
      <form className="flex gap-2" role="search">
        <input type="search" name="q" defaultValue={q ?? ""} placeholder="Buscar loja pelo nome" aria-label="Buscar loja pelo nome"
          className="min-h-11 flex-1 rounded-full border-2 border-peach bg-white px-4" />
        {status && <input type="hidden" name="situacao" value={status} />}
        <button type="submit" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Buscar</button>
      </form>

      {(onlyOpen || cityId) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
          <span className="text-sm font-semibold">Filtrando por:</span>
          {onlyOpen && <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">Abertas agora</span>}
          {cityId && stores[0] && <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">Cidade: {stores[0].city}</span>}
          <Link href="/admin/lojas" className="flex min-h-11 items-center text-sm font-bold text-brand-dark underline">Limpar filtros</Link>
        </div>
      )}
      <p className="text-sm text-coffee-soft" data-testid="list-summary"><strong className="text-coffee">{stores.length} loja{stores.length === 1 ? "" : "s"}</strong></p>
      <ul className="flex flex-col gap-2">
        {stores.map((store) => (
          <li key={store.id}>
            <Link href={`/admin/lojas/${store.id}`} data-testid="admin-store" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-4 ring-1 ring-peach hover:ring-brand">
              <span>
                <strong className="font-display text-lg">{store.name}</strong>
                <span className="block text-sm text-coffee-soft">
                  {store.category} · {store.city} · comissão {(Number(store.commission_rate) * 100).toFixed(1).replace(".", ",")}% · {store.products} produtos
                </span>
              </span>
              <span className="flex flex-wrap gap-1 text-sm font-bold">
                {store.featured && <span className="rounded-full bg-peach px-3 py-1">Destaque pago</span>}
                {store.overdue > 0 && <span className="rounded-full bg-danger px-3 py-1 text-white">Fatura vencida</span>}
                <span className={`rounded-full px-3 py-1 ${store.status === "active" ? "bg-success text-white" : store.status === "pending" ? "bg-brand text-coffee" : "bg-coffee text-peach"}`}>
                  {STORE_STATUS_LABELS[store.status]}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {stores.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma loja encontrada.</li>}
      </ul>
    </div>
  );
}
