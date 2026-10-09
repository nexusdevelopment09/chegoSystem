import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { TICKET_REASON_LABELS } from "@/lib/labels";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { adminReplyTicket } from "../../actions";

export const metadata: Metadata = { title: "Chamado" };

type Params = Promise<{ id: string }>;

export default function AdminTicketPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Ticket params={params} />
    </Suspense>
  );
}

async function Ticket({ params }: { params: Params }) {
  await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [ticket] = await sql<{
    id: string; reason: keyof typeof TICKET_REASON_LABELS; status: string; store_involved: boolean; created_at: Date; order_id: string; code: string;
    order_status: OrderStatus; total_cents: number; refunded_cents: number; customer_name: string; customer_phone: string | null; store_name: string;
  }[]>`
    select t.id, t.reason, t.status, t.store_involved, t.created_at, o.id as order_id, o.code, o.status as order_status,
           o.total_cents, o.refunded_cents, o.customer_name, o.customer_phone, s.name as store_name
    from support_tickets t join orders o on o.id = t.order_id join stores s on s.id = t.store_id
    where t.id = ${id}`;
  if (!ticket) notFound();

  const messages = await sql<{ id: string; sender_side: string; body: string; attachment_url: string | null; created_at: Date }[]>`
    select id, sender_side, body, attachment_url, created_at from ticket_messages where ticket_id = ${id} order by created_at`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <AutoRefresh seconds={10} />
      <Link href="/admin/suporte" className="font-semibold text-brand-dark underline">← Suporte</Link>
      <header>
        <h1 className="text-3xl">{TICKET_REASON_LABELS[ticket.reason]}</h1>
        <p className="text-coffee-soft">Aberto em {formatDateTime(ticket.created_at)}</p>
      </header>

      <section className="flex flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-peach">
        <p>
          <strong>{ticket.customer_name}</strong>{ticket.customer_phone && ` · ${formatPhone(ticket.customer_phone)}`} · {ticket.store_name}
        </p>
        <p className="text-sm">
          Pedido <strong>{ticket.code}</strong> · {STATUS_LABELS[ticket.order_status]} · {formatCents(ticket.total_cents)}
          {ticket.refunded_cents > 0 && ` · reembolsado ${formatCents(ticket.refunded_cents)}`}
        </p>
        <Link href={`/admin/pedidos/${ticket.order_id}`} className={buttonClass("secondary", "min-h-11 self-start px-4 text-sm")}>Abrir o pedido (reembolsar, ver histórico)</Link>
        {ticket.store_involved && <p className="text-sm font-semibold text-brand-darker">A loja já foi acionada.</p>}
      </section>

      <ul className="flex flex-col gap-2">
        {messages.map((message) => (
          <li key={message.id} className={`max-w-[85%] rounded-2xl px-3 py-2 ${message.sender_side === "admin" ? "self-end bg-peach" : "self-start bg-white ring-1 ring-peach"}`}>
            <p className="text-xs font-bold text-coffee-soft">
              {message.sender_side === "admin" ? "Equipe Chegô" : message.sender_side === "customer" ? "Cliente" : "Loja"} · {formatDateTime(message.created_at)}
            </p>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
            {message.attachment_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={message.attachment_url} alt="Foto enviada pelo cliente" width={280} height={280} loading="lazy" className="mt-2 rounded-xl" />
            )}
          </li>
        ))}
      </ul>

      <ActionForm action={adminReplyTicket} resetOnSuccess className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
        <input type="hidden" name="ticketId" value={ticket.id} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Responder ao cliente
          <textarea name="message" maxLength={1000} rows={3} className={`${inputClass} py-3 font-normal`} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Situação do chamado
          <select name="status" defaultValue={ticket.status === "open" ? "in_progress" : ticket.status} className={inputClass}>
            <option value="in_progress">Em andamento</option>
            <option value="waiting_customer">Aguardando cliente</option>
            <option value="resolved">Resolvido</option>
            <option value="open">Aberto</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="involveStore" defaultChecked={ticket.store_involved} className="size-5 accent-brand-dark" /> Acionar a loja (ela passa a ver este chamado)
        </label>
        <SubmitButton className="self-start">Salvar</SubmitButton>
      </ActionForm>
    </div>
  );
}
