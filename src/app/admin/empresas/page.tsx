import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/admin/Pagination";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { pageNumber } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { STORE_STATUS_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Empresas" };

type SearchParams = Promise<Record<string, string | undefined>>;
const PAGE = 25;
// A empresa é o responsável (dono) e o documento (CPF/CNPJ) das lojas dele.
const SITUATIONS = { ativas: "Com loja ativa", sem_ativas: "Sem loja ativa", encerradas: "Encerraram todas as lojas" } as const;

export default function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Companies searchParams={searchParams} />
    </Suspense>
  );
}

type Row = {
  owner_id: string; owner_name: string; phone: string | null; documents: string[] | null; first_at: Date;
  stores: { id: string; name: string; status: keyof typeof STORE_STATUS_LABELS; closed: boolean }[];
  orders: number; sales_cents: number; total: number;
};

async function Companies({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 80);
  const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const situation = params.situacao && params.situacao in SITUATIONS ? (params.situacao as keyof typeof SITUATIONS) : null;
  const page = pageNumber(params.pagina);

  const rows = await sql<Row[]>`
    with companies as (
      select s.owner_id,
             min(s.created_at) as first_at,
             array_remove(array_agg(distinct sp.document_number), null) as documents,
             json_agg(json_build_object('id', s.id, 'name', s.name, 'status', s.status, 'closed', s.closed_at is not null) order by s.name) as stores,
             bool_or(s.closed_at is null and s.status = 'active') as has_active,
             bool_and(s.closed_at is not null) as all_closed
      from stores s join store_private sp on sp.store_id = s.id
      group by s.owner_id
    )
    select c.owner_id, p.full_name as owner_name, p.phone, c.documents, c.first_at, c.stores,
           (select count(*)::int from orders o join stores s on s.id = o.store_id where s.owner_id = c.owner_id and o.paid_at is not null) as orders,
           (select coalesce(sum(o.total_cents - o.refunded_cents), 0)::bigint::int from orders o join stores s on s.id = o.store_id
             where s.owner_id = c.owner_id and o.paid_at is not null and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')) as sales_cents,
           count(*) over ()::int as total
    from companies c join profiles p on p.id = c.owner_id
    where true
      ${situation === "ativas" ? sql`and c.has_active` : situation === "sem_ativas" ? sql`and not c.has_active and not c.all_closed` : situation === "encerradas" ? sql`and c.all_closed` : sql``}
      ${search ? sql`and (unaccent(p.full_name) ilike unaccent(${like}) or p.phone ilike ${like} or c.owner_id::text ilike ${like}
          or exists (select 1 from unnest(c.documents) d where d ilike ${like})
          or exists (select 1 from stores s where s.owner_id = c.owner_id and unaccent(s.name) ilike unaccent(${like})))` : sql``}
    order by p.full_name, c.owner_id
    limit ${PAGE} offset ${(page - 1) * PAGE}`;
  const total = rows[0]?.total ?? 0;
  const here = (extra: Record<string, string | undefined>) => withQuery("/admin/empresas", { q: search || undefined, situacao: situation ?? undefined, ...extra });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Empresas</h1>
      <p className="text-coffee-soft">Cada empresa é o responsável pelas lojas, com o documento (CPF ou CNPJ) informado no cadastro.</p>
      <nav aria-label="Situação" className="flex flex-wrap gap-2">
        <Link href={here({ situacao: undefined })} className={buttonClass(!situation ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>Todas</Link>
        {Object.entries(SITUATIONS).map(([key, text]) => <Link key={key} href={here({ situacao: key })} className={buttonClass(situation === key ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>{text}</Link>)}
      </nav>
      <form method="get" className="flex flex-wrap gap-2" role="search">
        {situation && <input type="hidden" name="situacao" value={situation} />}
        <input type="search" name="q" defaultValue={search} placeholder="Nome, telefone, documento ou loja" aria-label="Buscar empresa" className={`${inputClass} min-h-11 flex-1`} />
        <button type="submit" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Buscar</button>
      </form>
      <p className="text-sm text-coffee-soft" data-testid="list-summary"><strong className="text-coffee">{total} empresa{total === 1 ? "" : "s"}</strong></p>
      {rows.length === 0 ? <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma empresa encontrada.</p> : (
        <ul className="flex flex-col gap-2" data-testid="companies">
          {rows.map((row) => (
            <li key={row.owner_id} className="flex flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-peach sm:flex-row sm:justify-between">
              <div className="min-w-0">
                <p className="font-display text-lg font-semibold">{row.owner_name}</p>
                <p className="text-sm text-coffee-soft">
                  {row.phone ? formatPhone(row.phone) : "Sem telefone"} · {row.documents?.length ? row.documents.join(", ") : "sem documento"} · desde {formatDateTime(row.first_at)}
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {row.stores.map((store) => (
                    <li key={store.id}><Link href={`/admin/lojas/${store.id}`} className="inline-flex min-h-11 items-center rounded-full bg-cream px-3 text-sm font-semibold underline">
                      {store.name} · {store.closed ? "Excluída" : STORE_STATUS_LABELS[store.status]}
                    </Link></li>
                  ))}
                </ul>
              </div>
              <div className="shrink-0 text-sm sm:text-right">
                <p><strong className="tabular-nums">{row.orders}</strong> pedidos</p>
                <p><strong className="tabular-nums">{formatCents(row.sales_cents)}</strong> em vendas</p>
                <Link href={withQuery("/admin/pedidos", { empresa: row.owner_id, periodo: "ano" })} className="font-bold text-brand-dark underline">Pedidos</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} size={PAGE} href={(target) => here({ pagina: String(target) })} />
    </div>
  );
}
