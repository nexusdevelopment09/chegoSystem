import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { PaymentLine } from "@/components/orders/PaymentLine";
import { Button } from "@/components/ui/Button";
import { quantityLabel } from "@/lib/catalog/weight";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { guestOrderId } from "@/lib/orders/guest";
import { loadGuestOrder } from "@/lib/orders/queries";
import { canTransition, IN_PROGRESS, STATUS_LABELS } from "@/lib/orders/status";
import { cancelGuestOrder } from "./actions";

export const metadata: Metadata = { title: "Acompanhar pedido", robots: { index: false, follow: false } };

type Params = Promise<{ token: string }>;

export default function GuestOrderPage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <GuestOrder params={params} />
        </Suspense>
      </main>
    </>
  );
}

// Pedido feito sem conta: quem tem o link acompanha. Chat, avaliação e ajuda pedem conta.
async function GuestOrder({ params }: { params: Params }) {
  const { token } = await params;
  const orderId = await guestOrderId(token);
  const order = orderId ? await loadGuestOrder(orderId) : null;
  if (!order) notFound();

  const live = IN_PROGRESS.includes(order.status);
  const canCancel = order.status === "paid" && canTransition(order.status, "cancelled", "customer", order.fulfillment);
  const showPixKey = order.paymentCollection === "store" && order.paymentMethod === "pix"
    && ["accepted", "preparing", "ready", "out_for_delivery", "delivered", "picked_up"].includes(order.status);
  const [store] = showPixKey ? await sql<{ pix_key: string | null }[]>`select pix_key from store_private where store_id = ${order.storeId}` : [];

  return (
    <div className="flex flex-col gap-4" data-testid="guest-order">
      {live && <AutoRefresh seconds={6} />}

      <header>
        <p className="text-sm text-coffee-soft">Pedido {order.code} · {formatDateTime(order.createdAt)}</p>
        <h1 className="text-3xl" data-testid="order-status">{STATUS_LABELS[order.status]}</h1>
        <p className="text-coffee-soft">Na <Link href={`/loja/${order.storeSlug}`} className="font-bold text-brand-dark underline">{order.storeName}</Link></p>
      </header>

      <p role="status" className="rounded-2xl bg-cream px-4 py-3 text-sm">
        <strong>Guarde este link</strong>: é por ele que você acompanha o pedido, porque ele foi feito sem conta.
        {" "}<Link href="/entrar/criar-conta" className="font-semibold text-brand-dark underline">Criar uma conta</Link> deixa seus próximos pedidos salvos.
      </p>

      {live && (
        <section className="rounded-card bg-peach p-4">
          {order.scheduledFor ? <p>Agendado para <strong>{formatDateTime(order.scheduledFor)}</strong>.</p>
            : order.estimatedAt && <p>Previsão: <strong>{formatDateTime(order.estimatedAt)}</strong>.</p>}
          {order.deliveryCode && (
            <p className="mt-1">
              Código de entrega: <strong className="text-2xl tracking-widest" data-testid="delivery-code">{order.deliveryCode}</strong>
              <span className="block text-sm text-coffee-soft">Diga este código ao entregador quando o pedido chegar.</span>
            </p>
          )}
        </section>
      )}

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
        <h2 className="mb-3 text-xl">Andamento</h2>
        <OrderTimeline fulfillment={order.fulfillment} status={order.status} history={order.history} />
      </section>

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
        <h2 className="mb-3 text-xl">Itens</h2>
        <ul className="mb-3">
          {order.items.map((item) => (
            <li key={item.id} className={`flex justify-between gap-3 border-b border-cream py-2 ${item.removed ? "text-coffee-soft line-through" : ""}`}>
              <span>
                {quantityLabel(item.quantity, item.weightStepGrams)} {item.name}
                {item.lines.map((line) => <span key={line} className="block pl-4 text-sm text-coffee-soft">{line}</span>)}
                {item.notes && <span className="block pl-4 text-sm text-coffee-soft">Obs: {item.notes}</span>}
                {item.removed && <span className="block text-sm font-semibold no-underline">Removido: {item.removedReason}</span>}
              </span>
              <span className="shrink-0">{formatCents(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <OrderSummary totals={order.totals} fulfillment={order.fulfillment} />
        <div className="mt-3"><PaymentLine order={order} pixKey={store?.pix_key ?? null} /></div>
      </section>

      {order.address && (
        <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
          <h2 className="mb-1 text-xl">Entrega</h2>
          <p>{order.address.street}, {order.address.number} · {order.address.neighborhood}</p>
          {order.address.reference && <p className="text-sm text-coffee-soft">Referência: {order.address.reference}</p>}
        </section>
      )}

      {canCancel && (
        <form action={cancelGuestOrder}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" variant="secondary" className="w-full">Cancelar pedido</Button>
          <p className="mt-1 text-center text-sm text-coffee-soft">Enquanto a loja não aceitar, você pode cancelar.</p>
        </form>
      )}
    </div>
  );
}
