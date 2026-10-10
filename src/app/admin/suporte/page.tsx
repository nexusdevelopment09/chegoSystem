import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { TICKET_REASON_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Suporte" };

const STATUS = { open: "Aberto", in_progress: "Em andamento", waiting_customer: "Aguardando cliente", resolved: "Resolvido" } as const;
// Primeiro os problemas de dinheiro, depois o que estraga o pedido, depois o resto.
const PRIORITY: Record<string, number> = { billing: 0, missing_item: 1, wrong_item: 1, damaged_item: 1, delay: 2, other: 3 };

export default function AdminSupportPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Queue />
    </Suspense>
  );
}

function waited(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} dias`;
}

async function Queue() {
  await requireRole("admin");
  const at = await now();
  const tickets = await sql<{
    id: string; reason: keyof typeof TICKET_REASON_LABELS; status: keyof typeof STATUS; code: string; customer_name: string;
    store_name: string; created_at: Date; last_side: string | null;
  }[]>`
    select t.id, t.reason, t.status, o.code, o.customer_name, s.name as store_name, t.created_at,
           (select m.sender_side from ticket_messages m where m.ticket_id = t.id order by m.created_at desc limit 1) as last_side
    from support_tickets t join orders o on o.id = t.order_id join stores s on s.id = t.store_id
    order by t.created_at desc limit 200`;

  const open = tickets
    .filter((ticket) => ticket.status !== "resolved")
    .sort((a, b) => PRIORITY[a.reason] - PRIORITY[b.reason] || a.created_at.getTime() - b.created_at.getTime());
  const resolved = tickets.filter((ticket) => ticket.status === "resolved").slice(0, 20);

  const row = (ticket: (typeof tickets)[number]) => (
    <li key={ticket.id}>
      <Link href={`/admin/suporte/${ticket.id}`} data-testid="admin-ticket" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-3 ring-1 ring-peach hover:ring-brand">
        <span>
          <strong>{TICKET_REASON_LABELS[ticket.reason]}</strong> · pedido {ticket.code}
          <span className="block text-sm text-coffee-soft">{ticket.customer_name} · {ticket.store_name}</span>
        </span>
        <span className="text-right text-sm">
          <span className="font-bold">{STATUS[ticket.status]}</span>
          {ticket.status !== "resolved" && (
            <span className={`block ${ticket.last_side === "customer" ? "font-bold text-danger" : "text-coffee-soft"}`}>
              {ticket.last_side === "customer" ? "Cliente esperando" : "Respondido"} · há {waited(ticket.created_at, at)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh seconds={15} />
      <h1 className="text-3xl">Suporte</h1>
      <section>
        <h2 className="mb-2 text-xl">Fila ({open.length})</h2>
        <ul className="flex flex-col gap-2">
          {open.map(row)}
          {open.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum chamado esperando.</li>}
        </ul>
      </section>
      {resolved.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl">Resolvidos recentes</h2>
          <ul className="flex flex-col gap-2">{resolved.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
