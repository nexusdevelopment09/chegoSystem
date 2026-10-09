import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Clientes" };

type SearchParams = Promise<{ q?: string }>;

export default function AdminCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const term = ((await searchParams).q ?? "").trim().slice(0, 60);
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

  const customers = await sql<{ id: string; full_name: string; phone: string | null; blocked: boolean; orders: number; spent: number }[]>`
    select p.id, p.full_name, p.phone, p.blocked_at is not null as blocked,
           (select count(*)::int from orders o where o.customer_id = p.id and o.paid_at is not null) as orders,
           (select coalesce(sum(o.total_cents - o.refunded_cents), 0)::int from orders o where o.customer_id = p.id and o.paid_at is not null) as spent
    from profiles p
    where p.role = 'customer' and p.deleted_at is null
      ${term ? sql`and (unaccent(p.full_name) ilike unaccent(${pattern}) or p.phone like ${`%${term.replace(/\D/g, "") || "x"}%`})` : sql``}
    order by orders desc, p.full_name
    limit 100`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Clientes</h1>
      <form className="flex gap-2" role="search">
        <input type="search" name="q" defaultValue={term} placeholder="Nome ou telefone" aria-label="Buscar cliente por nome ou telefone" className={inputClass} />
        <button type="submit" className={buttonClass("secondary")}>Buscar</button>
      </form>
      <ul className="flex flex-col gap-2">
        {customers.map((customer) => (
          <li key={customer.id}>
            <Link href={`/admin/clientes/${customer.id}`} data-testid="admin-customer" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-3 ring-1 ring-peach hover:ring-brand">
              <span>
                <strong>{customer.full_name || "Sem nome"}</strong>
                {customer.blocked && <span className="ml-2 rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">Bloqueado</span>}
                <span className="block text-sm text-coffee-soft">{customer.phone ? formatPhone(customer.phone) : "sem telefone"}</span>
              </span>
              <span className="text-right text-sm">{customer.orders} pedido{customer.orders === 1 ? "" : "s"}<span className="block font-bold">{formatCents(customer.spent)}</span></span>
            </Link>
          </li>
        ))}
        {customers.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum cliente encontrado.</li>}
      </ul>
    </div>
  );
}
