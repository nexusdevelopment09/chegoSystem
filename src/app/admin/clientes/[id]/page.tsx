import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { setCustomerBlocked, toggleCustomerCash } from "../../actions";

export const metadata: Metadata = { title: "Cliente" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
type Params = Promise<{ id: string }>;

export default function AdminCustomerPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Customer params={params} />
    </Suspense>
  );
}

async function Customer({ params }: { params: Params }) {
  await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [customer] = await sql<{
    id: string; full_name: string; phone: string | null; email: string | null; birth_date: string | null; blocked_at: Date | null;
    blocked_reason: string | null; cash_enabled: boolean; referral_code: string | null; created_at: Date;
  }[]>`
    select id, full_name, phone, email, birth_date::text, blocked_at, blocked_reason, cash_enabled, referral_code, created_at
    from profiles where id = ${id} and role = 'customer'`;
  if (!customer) notFound();

  const [orders, addresses] = await Promise.all([
    sql<{ id: string; code: string; status: OrderStatus; store_name: string; total_cents: number; created_at: Date }[]>`
      select o.id, o.code, o.status, s.name as store_name, o.total_cents, o.created_at
      from orders o join stores s on s.id = o.store_id where o.customer_id = ${id} order by o.created_at desc limit 40`,
    sql<{ id: string; street: string; number: string; neighborhood: string; reference: string | null }[]>`
      select a.id, a.street, a.number, n.name as neighborhood, a.reference
      from addresses a join neighborhoods n on n.id = a.neighborhood_id where a.profile_id = ${id} and a.deleted_at is null`,
  ]);
  const blocked = customer.blocked_at !== null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/clientes" className="font-semibold text-brand-dark underline">← Clientes</Link>
      <header>
        <h1 className="text-3xl">{customer.full_name || "Sem nome"}</h1>
        <p className="text-coffee-soft">
          {customer.phone ? formatPhone(customer.phone) : "sem telefone"}{customer.email && ` · ${customer.email}`} · cliente desde {formatDateTime(customer.created_at)}
        </p>
        {blocked && (
          <p role="status" data-testid="blocked-note" className="mt-2 rounded-2xl bg-danger px-4 py-3 font-bold text-white">
            Bloqueado em {formatDateTime(customer.blocked_at!)}. Motivo: {customer.blocked_reason}
          </p>
        )}
      </header>

      <ActionForm action={setCustomerBlocked} className={card}>
        <h2 className="text-xl">{blocked ? "Desbloquear cliente" : "Bloquear cliente"}</h2>
        <input type="hidden" name="id" value={customer.id} />
        <input type="hidden" name="block" value={blocked ? "0" : "1"} />
        {!blocked && <Field label="Motivo do bloqueio" name="reason" required maxLength={300} hint="Cliente bloqueado continua entrando no app, mas não consegue fazer pedido." />}
        <SubmitButton variant="secondary" className="self-start">{blocked ? "Desbloquear" : "Bloquear"}</SubmitButton>
      </ActionForm>

      <section className={card}>
        <h2 className="text-xl">Dinheiro na entrega</h2>
        <p className="text-sm text-coffee-soft">Recurso desligado no app por enquanto. Aqui você já deixa marcado quem poderá usar quando for ligado.</p>
        <form action={toggleCustomerCash}>
          <input type="hidden" name="id" value={customer.id} />
          <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm" aria-pressed={customer.cash_enabled}>
            {customer.cash_enabled ? "Liberado · tirar a liberação" : "Liberar para este cliente"}
          </Button>
        </form>
      </section>

      <section className={card}>
        <h2 className="text-xl">Endereços</h2>
        {addresses.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum endereço salvo.</p> : (
          <ul className="text-sm">
            {addresses.map((address) => (
              <li key={address.id}>{address.street}, {address.number} · {address.neighborhood}{address.reference && ` · Ref.: ${address.reference}`}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-xl">Pedidos</h2>
        {orders.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum pedido.</p> : (
          <ul className="text-sm">
            {orders.map((order) => (
              <li key={order.id} className="flex justify-between gap-2 border-b border-cream py-1">
                <span><Link href={`/admin/pedidos/${order.id}`} className="font-semibold text-brand-dark underline">{order.code}</Link> · {order.store_name} · {formatDateTime(order.created_at)}</span>
                <span>{STATUS_LABELS[order.status]} · {formatCents(order.total_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
