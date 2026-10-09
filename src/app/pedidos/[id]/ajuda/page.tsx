import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { fileInputClass, inputClass } from "@/components/ui/Field";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { TICKET_REASON_LABELS, TICKET_STATUS_LABELS } from "@/lib/labels";
import { loadOrder } from "@/lib/orders/queries";
import { openTicket, replyTicket } from "../../more-actions";

export const metadata: Metadata = { title: "Preciso de ajuda" };

type Params = Promise<{ id: string }>;

export default function HelpPage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <Help params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function Help({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const profile = await requireUser();
  const order = await loadOrder(profile.id, id);
  if (!order || order.customerId !== profile.id || !order.paidAt) notFound();

  // Read as the customer: Row Level Security only returns their own tickets.
  const { tickets, messages } = await withUser(profile.id, async (tx) => {
    const found = await tx<{ id: string; reason: keyof typeof TICKET_REASON_LABELS; status: keyof typeof TICKET_STATUS_LABELS; created_at: Date }[]>`
      select id, reason, status, created_at from support_tickets where order_id = ${order.id} order by created_at desc`;
    return {
      tickets: found,
      messages: await tx<{ id: string; ticket_id: string; sender_side: string; body: string; attachment_url: string | null; created_at: Date }[]>`
        select id, ticket_id, sender_side, body, attachment_url, created_at from ticket_messages
        where ticket_id = any(${found.map((ticket) => ticket.id)}::uuid[]) order by created_at`,
    };
  });
  const open = tickets.find((ticket) => ticket.status !== "resolved");

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh seconds={8} />
      <Link href={`/pedidos/${order.id}`} className="font-semibold text-brand-dark underline">← Pedido {order.code}</Link>
      <h1 className="text-3xl">Preciso de ajuda</h1>

      {tickets.map((ticket) => (
        <section key={ticket.id} data-testid="ticket" className="rounded-card bg-white p-4 ring-1 ring-peach">
          <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">{TICKET_REASON_LABELS[ticket.reason]}</h2>
            <span className="rounded-full bg-peach px-3 py-1 text-sm font-bold" data-testid="ticket-status">{TICKET_STATUS_LABELS[ticket.status]}</span>
          </header>
          <ul className="mb-3 flex flex-col gap-2">
            {messages.filter((message) => message.ticket_id === ticket.id).map((message) => (
              <li key={message.id} className={`max-w-[85%] rounded-2xl px-3 py-2 ${message.sender_side === "customer" ? "self-end bg-peach" : "self-start bg-cream"}`}>
                <p className="text-xs font-bold text-coffee-soft">
                  {message.sender_side === "customer" ? "Você" : message.sender_side === "admin" ? "Equipe Chegô" : "Loja"} · {formatDateTime(message.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                {message.attachment_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={message.attachment_url} alt="Foto enviada" width={240} height={240} loading="lazy" className="mt-2 rounded-xl" />
                )}
              </li>
            ))}
          </ul>
          {ticket.status !== "resolved" && (
            <ActionForm action={replyTicket} resetOnSuccess className="flex flex-col gap-2">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Responder
                <textarea name="message" required maxLength={1000} rows={2} className={`${inputClass} py-3 font-normal`} />
              </label>
              <SubmitButton variant="secondary" className="min-h-11 self-start px-4 text-sm">Enviar</SubmitButton>
            </ActionForm>
          )}
        </section>
      ))}

      {!open && (
        <ActionForm action={openTicket} className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="text-xl">O que aconteceu?</h2>
          <input type="hidden" name="orderId" value={order.id} />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Motivo
            <select name="reason" required defaultValue="" className={inputClass}>
              <option value="" disabled>Escolha o motivo</option>
              {Object.entries(TICKET_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Conte o que aconteceu
            <textarea name="message" required minLength={5} maxLength={1000} rows={4} className={`${inputClass} py-3 font-normal`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
            Foto (opcional)
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className={fileInputClass} />
          </label>
          <SubmitButton className="self-start">Abrir chamado</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
