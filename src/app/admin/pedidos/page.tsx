import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { ALL_STATUSES, STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

export const metadata: Metadata = { title: "Pedidos" };

type SearchParams = Promise<{ q?: string; situacao?: string }>;

export default function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const { q, situacao } = await searchParams;
  const status = ALL_STATUSES.includes(situacao as OrderStatus) ? (situacao as OrderStatus) : null;
  const term = (q ?? "").trim().slice(0, 60);
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

  const orders = await sql<{ id: string; code: string; status: OrderStatus; customer_name: string; store_name: string; total_cents: number; refunded_cents: number; created_at: Date }[]>`
    select o.id, o.code, o.status, o.customer_name, s.name as store_name, o.total_cents, o.refunded_cents, o.created_at
    from orders o join stores s on s.id = o.store_id
    where true
      ${status ? sql`and o.status = ${status}::order_status` : sql``}
      ${term ? sql`and (o.code ilike ${pattern} or unaccent(o.customer_name) ilike unaccent(${pattern}) or unaccent(s.name) ilike unaccent(${pattern}))` : sql``}
    order by o.created_at desc
    limit 100`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Pedidos</h1>
      <form className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]" role="search">
        <input type="search" name="q" defaultValue={term} placeholder="Código, cliente ou loja" aria-label="Buscar por código, cliente ou loja" className={inputClass} />
        <select name="situacao" defaultValue={status ?? ""} aria-label="Situação" className={inputClass}>
          <option value="">Todas as situações</option>
          {ALL_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select>
        <button type="submit" className={buttonClass("secondary")}>Buscar</button>
      </form>

      <p className="text-sm text-coffee-soft">{orders.length === 100 ? "Mostrando os 100 mais recentes." : `${orders.length} pedido${orders.length === 1 ? "" : "s"}.`}</p>
      <ul className="flex flex-col gap-2">
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/admin/pedidos/${order.id}`} data-testid="admin-order" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-3 ring-1 ring-peach hover:ring-brand">
              <span>
                <strong>{order.code}</strong> · {order.customer_name} · {order.store_name}
                <span className="block text-sm text-coffee-soft">{formatDateTime(order.created_at)}</span>
              </span>
              <span className="text-right">
                <strong>{formatCents(order.total_cents)}</strong>
                <span className="block text-sm font-semibold text-brand-darker">{STATUS_LABELS[order.status]}</span>
                {order.refunded_cents > 0 && <span className="block text-xs text-danger">Reembolsado {formatCents(order.refunded_cents)}</span>}
              </span>
            </Link>
          </li>
        ))}
        {orders.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum pedido encontrado.</li>}
      </ul>
    </div>
  );
}
