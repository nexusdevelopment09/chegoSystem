import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { Button, buttonClass } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth/session";
import { formatCents, formatDateTime } from "@/lib/format";
import { loadOrder } from "@/lib/orders/queries";
import { canTransition, IN_PROGRESS, STATUS_LABELS } from "@/lib/orders/status";
import { cancelOrder } from "../actions";

export const metadata: Metadata = { title: "Acompanhar pedido" };

type Params = Promise<{ id: string }>;

export default function OrderPage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <OrderContent params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function OrderContent({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const profile = await requireUser();
  const order = await loadOrder(profile.id, id);
  if (!order || order.customerId !== profile.id) notFound();

  const live = order.status === "awaiting_payment" || IN_PROGRESS.includes(order.status);
  const canCancel = order.status === "paid" && canTransition(order.status, "cancelled", "customer", order.fulfillment);

  return (
    <div className="flex flex-col gap-4">
      {live && <AutoRefresh seconds={4} />}

      <header>
        <p className="text-sm text-coffee-soft">
          Pedido {order.code} · {formatDateTime(order.createdAt)}
        </p>
        <h1 className="text-3xl" data-testid="order-status">{STATUS_LABELS[order.status]}</h1>
        <p className="text-coffee-soft">
          Na <Link href={`/loja/${order.storeSlug}`} className="font-bold text-brand-dark underline">{order.storeName}</Link>
        </p>
      </header>

      {order.status === "awaiting_payment" && (
        <Link href={`/pedidos/${order.id}/pagamento`} className={buttonClass("primary")}>Pagar agora</Link>
      )}

      {live && order.status !== "awaiting_payment" && (
        <section className="rounded-card bg-peach p-4">
          {order.scheduledFor ? (
            <p>Agendado para <strong>{formatDateTime(order.scheduledFor)}</strong>.</p>
          ) : (
            order.estimatedAt && <p>Previsão: <strong>{formatDateTime(order.estimatedAt)}</strong>.</p>
          )}
          {order.deliveryCode && (
            <p className="mt-1">
              Código de entrega: <strong className="text-2xl tracking-widest" data-testid="delivery-code">{order.deliveryCode}</strong>
              <span className="block text-sm text-coffee-soft">Diga este código ao entregador quando o pedido chegar.</span>
            </p>
          )}
        </section>
      )}

      {order.refundedCents > 0 && (
        <p role="status" data-testid="refund-note" className="rounded-2xl bg-peach px-4 py-3 font-semibold">
          Devolvemos {formatCents(order.refundedCents)} para você.
        </p>
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
                {item.quantity}x {item.name}
                {item.lines.map((line) => <span key={line} className="block pl-4 text-sm text-coffee-soft">{line}</span>)}
                {item.notes && <span className="block pl-4 text-sm text-coffee-soft">Obs: {item.notes}</span>}
                {item.removed && <span className="block text-sm font-semibold no-underline">Removido: {item.removedReason}</span>}
              </span>
              <span className="shrink-0">{formatCents(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <OrderSummary totals={order.totals} fulfillment={order.fulfillment} />
        <p className="mt-2 text-sm text-coffee-soft">
          Pagamento: {order.paymentMethod === "pix" ? "Pix" : "Cartão de crédito"}
        </p>
      </section>

      {order.address && (
        <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
          <h2 className="mb-1 text-xl">Entrega</h2>
          <p>{order.address.street}, {order.address.number} · {order.address.neighborhood}</p>
          {order.address.reference && <p className="text-sm text-coffee-soft">Referência: {order.address.reference}</p>}
        </section>
      )}

      {canCancel && (
        <form action={cancelOrder}>
          <input type="hidden" name="orderId" value={order.id} />
          <Button type="submit" variant="secondary" className="w-full">Cancelar pedido</Button>
          <p className="mt-1 text-center text-sm text-coffee-soft">Enquanto a loja não aceitar, você pode cancelar e recebe tudo de volta.</p>
        </form>
      )}

      <Link href="/pedidos" className="text-center font-semibold text-brand-dark underline">Todos os meus pedidos</Link>
    </div>
  );
}
