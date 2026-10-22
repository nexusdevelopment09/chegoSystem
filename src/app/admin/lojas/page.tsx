import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/admin/Pagination";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { pageNumber } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { STORE_STATUS_LABELS } from "@/lib/labels";
import { storeAvailability, type Shift } from "@/lib/stores/hours";
import { fromLocal } from "@/lib/time";
import { addDays } from "@/lib/fees/rules";

export const metadata: Metadata = { title: "Lojas" };

type SearchParams = Promise<Record<string, string | undefined>>;
const SITUATIONS = { ...STORE_STATUS_LABELS, excluida: "Excluída" } as const;
const SORTS = { nome: "Nome", recentes: "Cadastro mais recente", vendas: "Mais vendas", pedidos: "Mais pedidos" } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 25;

export default function AdminStoresPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Stores searchParams={searchParams} />
    </Suspense>
  );
}

type Row = {
  id: string; name: string; status: keyof typeof STORE_STATUS_LABELS; closed_at: Date | null; city: string; category: string; created_at: Date;
  owner_id: string; owner_name: string; document: string | null; orders: number; sales_cents: number; rating_avg: string | null; rating_count: number;
  live_ads: number; suspensions: number; manual_state: "auto" | "open" | "closed"; paused_until: Date | null; shifts: Shift[];
};

async function Stores({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const params = await searchParams;
  const at = await now();
  const situation = params.situacao && params.situacao in SITUATIONS ? (params.situacao as keyof typeof SITUATIONS) : null;
  const onlyOpen = params.abertas === "1";
  const cityId = params.cidade && /^[0-9a-f-]{36}$/i.test(params.cidade) ? params.cidade : null;
  const search = (params.q ?? "").trim().slice(0, 80);
  const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const from = params.de && DATE.test(params.de) ? params.de : null;
  const to = params.ate && DATE.test(params.ate) ? params.ate : null;
  const sort = params.ordem && params.ordem in SORTS ? (params.ordem as keyof typeof SORTS) : "nome";
  const page = pageNumber(params.pagina);

  const where = sql`
    true
    ${situation === "excluida" ? sql`and s.closed_at is not null` : situation ? sql`and s.closed_at is null and s.status = ${situation}::store_status` : sql``}
    ${cityId ? sql`and s.city_id = ${cityId}` : sql``}
    ${from ? sql`and s.created_at >= ${fromLocal(from, 0)}` : sql``}
    ${to ? sql`and s.created_at < ${fromLocal(addDays(to, 1), 0)}` : sql``}
    ${search ? sql`and (unaccent(s.name) ilike unaccent(${like}) or s.id::text ilike ${like} or s.slug ilike ${like}
        or unaccent(o.full_name) ilike unaccent(${like}) or sp.document_number ilike ${like})` : sql``}`;
  const order = { nome: sql`s.name`, recentes: sql`s.created_at desc`, vendas: sql`sales_cents desc, s.name`, pedidos: sql`orders desc, s.name` }[sort];
  const select = sql`
    select s.id, s.name, s.status, s.closed_at, c.name as city, cat.name as category, s.created_at, s.owner_id, o.full_name as owner_name,
           sp.document_number as document, s.rating_avg, s.rating_count,
           (select count(*)::int from orders x where x.store_id = s.id and x.paid_at is not null) as orders,
           (select coalesce(sum(x.total_cents - x.refunded_cents), 0)::bigint::int from orders x
             where x.store_id = s.id and x.paid_at is not null and x.status not in ('rejected', 'cancelled', 'refunded', 'expired')) as sales_cents,
           (select count(*)::int from ad_campaigns a where a.store_id = s.id and a.status = 'ativa' and a.starts_at <= ${at} and a.ends_at > ${at}) as live_ads,
           (select count(*)::int from store_suspensions su where su.store_id = s.id) as suspensions,
           s.manual_state, s.paused_until,
           coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text))
                     from store_hours h where h.store_id = s.id), '[]') as shifts
    from stores s join cities c on c.id = s.city_id join categories cat on cat.id = s.category_id
    join profiles o on o.id = s.owner_id join store_private sp on sp.store_id = s.id`;

  // "Abertas agora" depende do horário de cada loja: calculado aqui, sobre a lista filtrada.
  let rows: Row[];
  let total: number;
  if (onlyOpen) {
    const all = await sql<Row[]>`${select} where ${where} and s.closed_at is null and s.status in ('active', 'paused') order by ${order}`;
    const open = all.filter((store) => storeAvailability({ status: store.status as "active" | "paused", manualState: store.manual_state, pausedUntil: store.paused_until, shifts: store.shifts, closures: [] }, at).state === "open");
    total = open.length;
    rows = open.slice((page - 1) * PAGE, page * PAGE);
  } else {
    const [[count], list] = await Promise.all([
      sql<{ total: number }[]>`select count(*)::int as total from stores s join profiles o on o.id = s.owner_id join store_private sp on sp.store_id = s.id where ${where}`,
      sql<Row[]>`${select} where ${where} order by (s.status = 'pending' and s.closed_at is null) desc, ${order}, s.id limit ${PAGE} offset ${(page - 1) * PAGE}`,
    ]);
    total = count.total;
    rows = list;
  }

  const keep = { situacao: situation ?? undefined, cidade: cityId ?? undefined, q: search || undefined, de: from ?? undefined, ate: to ?? undefined, ordem: sort === "nome" ? undefined : sort, abertas: onlyOpen ? "1" : undefined };
  const here = (extra: Record<string, string | undefined>) => withQuery("/admin/lojas", { ...keep, pagina: undefined, ...extra });
  const label = (row: Row) => (row.closed_at ? "Excluída" : STORE_STATUS_LABELS[row.status]);
  const tone = (row: Row) => (row.closed_at ? "bg-coffee text-peach" : row.status === "active" ? "bg-success text-white" : row.status === "pending" ? "bg-brand text-coffee" : row.status === "suspended" ? "bg-danger text-white" : "bg-cream");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Lojas</h1>
      <nav aria-label="Situação" className="flex flex-wrap gap-2">
        <Link href={here({ situacao: undefined })} aria-current={!situation ? "true" : undefined} className={buttonClass(!situation ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>Todas</Link>
        {Object.entries(SITUATIONS).map(([value, text]) => (
          <Link key={value} href={here({ situacao: value })} aria-current={situation === value ? "true" : undefined}
            className={buttonClass(situation === value ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>{text}</Link>
        ))}
      </nav>
      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-2 lg:grid-cols-4" role="search">
        {situation && <input type="hidden" name="situacao" value={situation} />}
        {cityId && <input type="hidden" name="cidade" value={cityId} />}
        <label className="flex flex-col gap-1 text-xs font-semibold lg:col-span-2">Nome, identificador, responsável ou documento
          <input type="search" name="q" defaultValue={search} aria-label="Buscar loja" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Cadastrada de<input type="date" name="de" defaultValue={from ?? ""} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">até<input type="date" name="ate" defaultValue={to ?? ""} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Ordem
          <select name="ordem" defaultValue={sort} className={inputClass}>{Object.entries(SORTS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
        </label>
        <button type="submit" className={buttonClass("primary", "min-h-11 self-end")}>Buscar</button>
      </form>

      {(onlyOpen || cityId || search || from || to) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="active-filters">
          <span className="text-sm font-semibold">Filtrando por:</span>
          {onlyOpen && <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">Abertas agora</span>}
          {cityId && rows[0] && <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">Cidade: {rows[0].city}</span>}
          {search && <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">Busca: {search}</span>}
          {(from || to) && <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold">Cadastro: {from ?? "…"} a {to ?? "…"}</span>}
          <Link href="/admin/lojas" className="flex min-h-11 items-center text-sm font-bold text-brand-dark underline">Limpar filtros</Link>
        </div>
      )}
      <p className="text-sm text-coffee-soft" data-testid="list-summary"><strong className="text-coffee">{total} loja{total === 1 ? "" : "s"}</strong></p>

      {rows.length === 0 ? <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma loja encontrada.</p> : (
        <div className="overflow-x-auto rounded-card bg-white ring-1 ring-peach" tabIndex={0} role="region" aria-label="Lojas (role para o lado para ver tudo)">
          <table className="w-full min-w-[1000px] text-sm">
            <thead><tr className="text-left text-coffee-soft">
              <th className="px-3 py-2">Loja</th><th className="pr-2">Empresa / responsável</th><th className="pr-2">Cadastro</th><th className="pr-2">Situação</th>
              <th className="pr-2 text-right">Pedidos</th><th className="pr-2 text-right">Vendas</th><th className="pr-2">Avaliação</th><th className="pr-2">Anúncios</th><th className="pr-3">Ocorrências</th>
            </tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-cream align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/lojas/${row.id}`} data-testid="admin-store" className="font-display text-base font-semibold text-brand-dark underline">{row.name}</Link>
                    <span className="block text-xs text-coffee-soft">{row.category} · {row.city} · ID {row.id.slice(0, 8)}</span>
                  </td>
                  <td className="py-2 pr-2"><Link href={`/admin/empresas?q=${encodeURIComponent(row.owner_name)}`} className="underline">{row.owner_name}</Link>
                    {row.document && <span className="block text-xs text-coffee-soft">{row.document}</span>}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="py-2 pr-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone(row)}`}>{label(row)}</span></td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.orders}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatCents(row.sales_cents)}</td>
                  <td className="py-2 pr-2">{row.rating_avg === null ? "—" : `${Number(row.rating_avg).toFixed(1).replace(".", ",")} ★ (${row.rating_count})`}</td>
                  <td className="py-2 pr-2">{row.live_ads > 0 ? <span className="rounded-full bg-peach px-2.5 py-1 text-xs font-bold">No ar</span> : "—"}</td>
                  <td className="py-2 pr-3">{row.suspensions > 0 ? `${row.suspensions} suspens${row.suspensions === 1 ? "ão" : "ões"}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} size={PAGE} href={(target) => here({ pagina: String(target) })} />
    </div>
  );
}
