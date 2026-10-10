import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { loadOrder } from "@/lib/orders/queries";
import { ALL_STATUSES, STATUS_LABELS } from "@/lib/orders/status";
import { adminRefund, adminSetStatus } from "../../actions";

export const metadata: Metadata = { title: "Pedido" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const PAYMENT_LABELS: Record<string, string> = {
  pending: "Pendente", approved: "Aprovado", declined: "Recusado", expired: "Expirado", refunded: "Reembolsado", partially_refunded: "Reembolsado em parte",
};

type Params = Promise<{ id: string }>;

export default function AdminOrderPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <OrderDetail params={params} />
    </Suspense>
  );
}

async function OrderDetail({ params }: { params: Params }) {
  const profile = await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Carregado como admin: as regras de acesso por linha (RLS) deixam o admin ver todos os pedidos.
  const order = await loadOrder(profile.id, id);
  if (!order) notFound();

  const [payments, refunds, ledger, history] = await Promise.all([
    sql<{ id: string; method: string; status: string; amount_cents: number; provider_payment_id: string; created_at: Date }[]>`
      select id, method, status, amount_cents, provider_payment_id, created_at from payments where order_id = ${id} order by created_at`,
    sql<{ id: string; amount_cents: number; store_share_cents: number; platform_share_cents: number; reason: string; by: string | null; created_at: Date }[]>`
      select r.id, r.amount_cents, r.store_share_cents, r.platform_share_cents, r.reason, p.full_name as by, r.created_at
      from refunds r left join profiles p on p.id = r.requested_by where r.order_id = ${id} order by r.created_at`,
    sql<{ id: string; account: string; direction: string; amount_cents: number; reason: string; created_at: Date }[]>`
      select id, account, direction, amount_cents, reason, created_at from ledger_entries where order_id = ${id} order by created_at, account`,
    sql<{ status: string; by: string | null; reason: string | null; created_at: Date }[]>`
      select h.status, p.full_name as by, h.reason, h.created_at
      from order_status_history h left join profiles p on p.id = h.changed_by where h.order_id = ${id} order by h.created_at`,
  ]);
  const remaining = order.totals.totalCents - order.refundedCents;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/pedidos" className="font-semibold text-brand-dark underline">← Pedidos</Link>
      <header>
        <h1 className="text-3xl">Pedido {order.code}</h1>
        <p className="font-bold text-brand-darker" data-testid="admin-order-status">{STATUS_LABELS[order.status]}</p>
        <p className="text-sm text-coffee-soft">
          {formatDateTime(order.createdAt)} · <Link href={`/admin/lojas/${order.storeId}`} className="font-semibold text-brand-dark underline">{order.storeName}</Link>
        </p>
      </header>

      <section className={card}>
        <h2 className="text-xl">Cliente e entrega</h2>
        <p>
          <Link href={`/admin/clientes/${order.customerId}`} className="font-semibold text-brand-dark underline">{order.customerName}</Link>
          {order.customerPhone && ` · ${formatPhone(order.customerPhone)}`}
        </p>
        {order.address ? (
          <p>{order.address.street}, {order.address.number} · {order.address.neighborhood}{order.address.reference && ` · Ref.: ${order.address.reference}`}</p>
        ) : <p>Retirada no balcão</p>}
        {order.deliveryCode && <p className="text-sm">Código de entrega: <strong>{order.deliveryCode}</strong></p>}
        {order.requiresAgeCheck && <p className="font-bold text-danger">Bebida alcoólica: conferir documento na entrega.</p>}
      </section>

      <section className={card}>
        <h2 className="text-xl">Itens e valores</h2>
        <ul>
          {order.items.map((item) => (
            <li key={item.id} className={`flex justify-between gap-3 border-b border-cream py-1 ${item.removed ? "text-coffee-soft line-through" : ""}`}>
              <span>{item.quantity}x {item.name}{item.lines.map((line) => <span key={line} className="block pl-4 text-sm">{line}</span>)}</span>
              <span>{formatCents(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <OrderSummary totals={order.totals} fulfillment={order.fulfillment} />
        <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-cream p-3 text-sm sm:grid-cols-4" data-testid="split">
          <div><dt className="text-coffee-soft">Comissão</dt><dd className="font-bold">{formatCents(order.totals.commissionCents)}</dd></div>
          <div><dt className="text-coffee-soft">Parte da plataforma</dt><dd className="font-bold">{formatCents(order.totals.platformAmountCents)}</dd></div>
          <div><dt className="text-coffee-soft">Parte da loja</dt><dd className="font-bold">{formatCents(order.totals.storeAmountCents)}</dd></div>
          <div><dt className="text-coffee-soft">Já reembolsado</dt><dd className="font-bold" data-testid="admin-refunded">{formatCents(order.refundedCents)}</dd></div>
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-xl">Pagamentos e financeiro</h2>
        <ul className="text-sm">
          {payments.map((payment) => (
            <li key={payment.id} className="border-b border-cream py-1">
              {payment.method === "pix" ? "Pix" : "Cartão"} · {formatCents(payment.amount_cents)} · <strong>{PAYMENT_LABELS[payment.status]}</strong> · {formatDateTime(payment.created_at)}
              <span className="block break-all text-xs text-coffee-soft">{payment.provider_payment_id}</span>
            </li>
          ))}
          {payments.length === 0 && <li className="text-coffee-soft">Nenhum pagamento.</li>}
        </ul>
        {refunds.length > 0 && (
          <>
            <h3 className="text-lg">Reembolsos</h3>
            <ul className="text-sm">
              {refunds.map((refund) => (
                <li key={refund.id} className="border-b border-cream py-1">
                  <strong>{formatCents(refund.amount_cents)}</strong> (loja {formatCents(refund.store_share_cents)}, plataforma {formatCents(refund.platform_share_cents)}) · {refund.reason}
                  <span className="block text-xs text-coffee-soft">{refund.by ?? "Sistema"} · {formatDateTime(refund.created_at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className="text-lg">Lançamentos</h3>
        <ul className="text-sm" data-testid="ledger">
          {ledger.map((entry) => (
            <li key={entry.id} className="flex justify-between gap-2 border-b border-cream py-1">
              <span>{entry.account === "store" ? "Loja" : "Plataforma"} · {entry.reason === "sale" ? "venda" : entry.reason === "refund" ? "reembolso" : entry.reason}</span>
              <span className={entry.direction === "credit" ? "font-semibold text-success" : "font-semibold text-danger"}>
                {entry.direction === "credit" ? "+" : "−"} {formatCents(entry.amount_cents)}
              </span>
            </li>
          ))}
          {ledger.length === 0 && <li className="text-coffee-soft">Nenhum lançamento.</li>}
        </ul>
      </section>

      {order.paidAt && remaining > 0 && (
        <ActionForm action={adminRefund} className={card}>
          <h2 className="text-xl">Reembolsar</h2>
          <input type="hidden" name="orderId" value={order.id} />
          <p className="text-sm text-coffee-soft">Ainda pode ser devolvido: {formatCents(remaining)}.</p>
          <label className="flex min-h-11 items-center gap-3"><input type="radio" name="kind" value="total" className="size-5 accent-brand-dark" /> Reembolso total</label>
          <label className="flex min-h-11 items-center gap-3"><input type="radio" name="kind" value="partial" defaultChecked className="size-5 accent-brand-dark" /> Reembolso parcial</label>
          <Field label="Valor do reembolso parcial (R$)" name="amount" inputMode="decimal" placeholder="10,00" />
          <Field label="Motivo" name="reason" required maxLength={300} />
          <SubmitButton className="self-start">Reembolsar</SubmitButton>
        </ActionForm>
      )}

      <ActionForm action={adminSetStatus} className={card}>
        <h2 className="text-xl">Alterar situação (caso excepcional)</h2>
        <p className="text-sm text-coffee-soft">Use só quando o fluxo normal não resolve. A alteração fica registrada com o seu nome e o motivo.</p>
        <input type="hidden" name="orderId" value={order.id} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Nova situação
          <select name="status" defaultValue="" required className={inputClass}>
            <option value="" disabled>Escolha</option>
            {ALL_STATUSES.filter((status) => status !== "paid" && status !== "awaiting_payment" && status !== order.status).map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <Field label="Motivo" name="reason" required maxLength={300} />
        <SubmitButton variant="secondary" className="self-start">Alterar situação</SubmitButton>
      </ActionForm>

      <section className={card}>
        <h2 className="text-xl">Histórico</h2>
        <OrderTimeline fulfillment={order.fulfillment} status={order.status} history={order.history} />
        <ul className="text-sm text-coffee-soft">
          {history.map((entry, index) => (
            <li key={index}>{formatDateTime(entry.created_at)} · {STATUS_LABELS[entry.status as keyof typeof STATUS_LABELS]} · {entry.by ?? "Sistema"}{entry.reason && ` · ${entry.reason}`}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
