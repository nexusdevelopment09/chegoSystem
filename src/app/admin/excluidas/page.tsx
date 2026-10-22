import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/admin/Pagination";
import { buttonClass } from "@/components/ui/Button";
import { pageNumber } from "@/lib/admin/page";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Empresas excluídas" };

type SearchParams = Promise<{ por?: string; pagina?: string }>;
const PAGE = 30;
const BY = { empresa: "Encerradas pela empresa", admin: "Excluídas pelo Chegô" } as const;

export default function ClosedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Closed searchParams={searchParams} />
    </Suspense>
  );
}

async function Closed({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const params = await searchParams;
  const by = params.por && params.por in BY ? (params.por as keyof typeof BY) : null;
  const page = pageNumber(params.pagina);
  const [counts, rows] = await Promise.all([
    sql<{ by: keyof typeof BY; total: number }[]>`select closed_by_kind as by, count(*)::int as total from stores where closed_at is not null group by 1`,
    sql<{ id: string; name: string; owner: string; closed_at: Date; closed_reason: string; closed_by_kind: keyof typeof BY; closed_by: string | null; created_at: Date; orders: number; sales_cents: number; pending_fees: number; total: number }[]>`
      select s.id, s.name, o.full_name as owner, s.closed_at, s.closed_reason, s.closed_by_kind, p.full_name as closed_by, s.created_at,
             (select count(*)::int from orders x where x.store_id = s.id and x.paid_at is not null) as orders,
             (select coalesce(sum(x.total_cents - x.refunded_cents), 0)::bigint::int from orders x where x.store_id = s.id and x.paid_at is not null
               and x.status not in ('rejected', 'cancelled', 'refunded', 'expired')) as sales_cents,
             (select coalesce(sum(c.total_due_cents), 0)::bigint::int from store_closings c where c.store_id = s.id and c.status in ('awaiting_payment', 'overdue')) as pending_fees,
             count(*) over ()::int as total
      from stores s join profiles o on o.id = s.owner_id left join profiles p on p.id = s.closed_by
      where s.closed_at is not null ${by ? sql`and s.closed_by_kind = ${by}` : sql``}
      order by s.closed_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
  ]);
  const count = (key: keyof typeof BY) => counts.find((row) => row.by === key)?.total ?? 0;
  const total = rows[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Empresas excluídas</h1>
      <p className="text-coffee-soft">Lojas encerradas pela própria empresa ou excluídas pelo Chegô. Pedidos, taxas e lançamentos continuam guardados.</p>
      <nav aria-label="Quem encerrou" className="flex flex-wrap gap-2">
        <Link href="/admin/excluidas" className={buttonClass(!by ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>Todas ({count("empresa") + count("admin")})</Link>
        {(Object.keys(BY) as (keyof typeof BY)[]).map((key) => (
          <Link key={key} href={`/admin/excluidas?por=${key}`} className={buttonClass(by === key ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>{BY[key]} ({count(key)})</Link>
        ))}
      </nav>
      {rows.length === 0 ? <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma loja excluída.</p> : (
        <ul className="flex flex-col gap-2" data-testid="closed-stores">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 rounded-card bg-white p-4 text-sm ring-1 ring-peach">
              <p><Link href={`/admin/lojas/${row.id}`} className="font-display text-lg font-semibold text-brand-dark underline">{row.name}</Link> · {row.owner}</p>
              <p><strong>{BY[row.closed_by_kind]}</strong> em {formatDateTime(row.closed_at)}{row.closed_by && <> por {row.closed_by}</>} · cadastrada em {formatDateTime(row.created_at)}</p>
              <p>Motivo: {row.closed_reason}</p>
              <p className="text-coffee-soft">{row.orders} pedidos · {formatCents(row.sales_cents)} em vendas
                {row.pending_fees > 0 && <> · <strong className="text-danger">{formatCents(row.pending_fees)} em taxas a receber</strong></>}</p>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} size={PAGE} href={(target) => `/admin/excluidas?${new URLSearchParams({ ...(by ? { por: by } : {}), pagina: String(target) })}`} />
    </div>
  );
}
