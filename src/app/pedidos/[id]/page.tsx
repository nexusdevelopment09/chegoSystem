import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { OrderChat } from "@/components/orders/OrderChat";
import { PaymentLine } from "@/components/orders/PaymentLine";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { ReorderButton } from "@/components/orders/ReorderButton";
import { ReviewForm } from "@/components/orders/ReviewForm";
import { Button, buttonClass } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql, withUser } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { chatOpen } from "@/lib/orders/moderation";
import { loadOrder } from "@/lib/orders/queries";
import { canTransition, IN_PROGRESS, STATUS_LABELS } from "@/lib/orders/status";
import { getSettings } from "@/lib/settings";
import { DAY_MS } from "@/lib/time";
import { cancelOrder } from "../actions";
import { quantityLabel } from "@/lib/catalog/weight";

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

  const [at, settings] = await Promise.all([now(), getSettings()]);
  const [review] = await withUser(profile.id, (tx) => tx<{ rating: number; comment: string | null; reply: string | null }[]>`
    select rating, comment, reply from reviews where order_id = ${order.id}`);
  const canReview = order.completedAt !== null && !review
    && at.getTime() <= order.completedAt.getTime() + settings.review_window_days * DAY_MS;

  // Pix direto para a loja: a chave aparece só depois que a loja aceitou o pedido.
  const showPixKey = order.paymentCollection === "store" && order.paymentMethod === "pix"
    && ["accepted", "preparing", "ready", "out_for_delivery", "delivered", "picked_up"].includes(order.status);
  const [store] = showPixKey
    ? await sql<{ pix_key: string | null }[]>`select pix_key from store_private where store_id = ${order.storeId}`
    : [];
  const pixKey = store?.pix_key ?? null;

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
        <div className="mt-3">
          <PaymentLine order={order} pixKey={pixKey} />
        </div>
      </section>

      {order.address && (
        <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
          <h2 className="mb-1 text-xl">Entrega</h2>
          <p>{order.address.street}, {order.address.number} · {order.address.neighborhood}</p>
          {order.address.reference && <p className="text-sm text-coffee-soft">Referência: {order.address.reference}</p>}
        </section>
      )}

      {order.paidAt && (
        <OrderChat orderId={order.id} viewerId={profile.id} side="customer"
          open={chatOpen({ paidAt: order.paidAt, completedAt: order.completedAt, status: order.status }, at)} />
      )}

      {(review || canReview) && (
        <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach" data-testid="review-box">
          <h2 className="mb-2 text-xl">Avaliação</h2>
          {review ? (
            <>
              <p className="font-bold text-brand-dark" aria-label={`Você deu ${review.rating} de 5 estrelas`}>
                {"★".repeat(review.rating)}<span className="text-peach">{"★".repeat(5 - review.rating)}</span>
              </p>
              {review.comment && <p>{review.comment}</p>}
              {review.reply && <p className="mt-2 rounded-2xl bg-cream px-3 py-2 text-sm"><strong>Resposta da loja:</strong> {review.reply}</p>}
            </>
          ) : (
            <ReviewForm orderId={order.id} storeName={order.storeName} />
          )}
        </section>
      )}

      {!live && <ReorderButton orderId={order.id} />}

      {order.paidAt && (
        <Link href={`/pedidos/${order.id}/ajuda`} className={buttonClass("secondary")}>Preciso de ajuda</Link>
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
