import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Panel } from "@/components/admin/Kpi";
import { Pagination } from "@/components/admin/Pagination";
import { pageNumber } from "@/lib/admin/page";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Contas suspensas" };

type SearchParams = Promise<{ pagina?: string }>;
const PAGE = 30;

export default function SuspendedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Suspended searchParams={searchParams} />
    </Suspense>
  );
}

type Item = {
  id: string; store_id: string; store_name: string; owner: string; reason: string; description: string | null; starts_at: Date; ends_at: Date | null;
  applied_at: Date | null; lifted_at: Date | null; lift_reason: string | null; created_by: string | null; lifted_by: string | null;
};

async function Suspended({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const page = pageNumber((await searchParams).pagina);
  const at = await now();
  const select = sql`
    select su.id, su.store_id, s.name as store_name, o.full_name as owner, su.reason, su.description, su.starts_at, su.ends_at,
           su.applied_at, su.lifted_at, su.lift_reason, c.full_name as created_by, l.full_name as lifted_by
    from store_suspensions su join stores s on s.id = su.store_id join profiles o on o.id = s.owner_id
    left join profiles c on c.id = su.created_by left join profiles l on l.id = su.lifted_by`;
  const [open, [{ total }], history] = await Promise.all([
    sql<Item[]>`${select} where su.lifted_at is null order by su.starts_at`,
    sql<{ total: number }[]>`select count(*)::int as total from store_suspensions where lifted_at is not null`,
    sql<Item[]>`${select} where su.lifted_at is not null order by su.lifted_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
  ]);
  const scheduled = open.filter((item) => !item.applied_at);
  const active = open.filter((item) => item.applied_at);

  const card = (item: Item) => (
    <li key={item.id} className="rounded-card bg-cream px-4 py-3 text-sm" data-testid="suspension">
      <p><Link href={`/admin/lojas/${item.store_id}`} className="font-display text-base font-semibold text-brand-dark underline">{item.store_name}</Link> · {item.owner}</p>
      <p><strong>{item.reason}</strong>{item.description && <span className="text-coffee-soft"> · {item.description}</span>}</p>
      <p className="text-coffee-soft">
        {formatDateTime(item.starts_at)} → {item.ends_at ? formatDateTime(item.ends_at) : "tempo indeterminado"} · por {item.created_by ?? "—"}
        {!item.lifted_at && item.ends_at && item.ends_at > at && <> · termina sozinha no fim do prazo</>}
      </p>
      {item.lifted_at && <p className="text-coffee-soft">Reativada em {formatDateTime(item.lifted_at)} por {item.lifted_by ?? "processo automático"}: {item.lift_reason}</p>}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Contas suspensas</h1>
      <p className="text-coffee-soft">Suspensa, a loja some da vitrine e não recebe pedidos novos. Reative pela página da loja (só o super admin).</p>
      <Panel title={`Suspensas agora (${active.length})`}>
        {active.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma loja suspensa.</p> : <ul className="flex flex-col gap-2">{active.map(card)}</ul>}
      </Panel>
      <Panel title={`Agendadas (${scheduled.length})`}>
        {scheduled.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma suspensão agendada.</p> : <ul className="flex flex-col gap-2">{scheduled.map(card)}</ul>}
      </Panel>
      <Panel title={`Histórico de suspensões encerradas (${total})`}>
        {history.length === 0 ? <p className="text-sm text-coffee-soft">Ainda não há suspensões encerradas.</p> : <ul className="flex flex-col gap-2">{history.map(card)}</ul>}
        <Pagination page={page} total={total} size={PAGE} href={(target) => `/admin/suspensas?pagina=${target}`} />
      </Panel>
    </div>
  );
}
