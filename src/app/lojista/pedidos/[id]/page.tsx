import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { PaymentLine } from "@/components/orders/PaymentLine";
import { OrderActions, RemoveItemButton } from "@/components/merchant/OrderActions";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { OrderChat } from "@/components/orders/OrderChat";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { getMerchantContext, getTeam } from "@/lib/merchant/context";
import { chatOpen } from "@/lib/orders/moderation";
import { loadOrder } from "@/lib/orders/queries";
import { STATUS_LABELS } from "@/lib/orders/status";
import { deliverWithOwnCourier, recallCouriers } from "../../actions";
import { quantityLabel } from "@/lib/catalog/weight";

export const metadata: Metadata = { title: "Pedido" };

const MISSING_LABELS = { call: "Ligar para o cliente", substitute: "Substituir por similar", remove: "Remover o item (sai do total)" };

type Params = Promise<{ id: string }>;

export default function MerchantOrderPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <OrderDetail params={params} />
    </Suspense>
  );
}

async function OrderDetail({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { profile, membership, store, at } = await getMerchantContext(["owner", "attendant"]);
  const order = await loadOrder(profile.id, id);
  if (!order || order.storeId !== store.id) notFound();

  const team = await getTeam(store.id);
  const couriers = team.filter((member) => member.role === "courier").map((member) => ({ id: member.id, name: member.name }));
  const courier = team.find((member) => member.id === order.courierId);
  const canRemove = order.status === "accepted" || order.status === "preparing";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <AutoRefresh seconds={5} />
      <Link href="/lojista/pedidos" className="font-semibold text-brand-dark underline">← Todos os pedidos</Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl">Pedido {order.code}</h1>
          <p className="font-bold text-brand-darker" data-testid="merchant-order-status">{STATUS_LABELS[order.status]}</p>
          <p className="text-sm text-coffee-soft">Feito em {formatDateTime(order.createdAt)}</p>
        </div>
        <Link href={`/lojista/pedidos/${order.id}/imprimir?l=${store.printerWidth}`} target="_blank" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
          Imprimir
        </Link>
      </header>

      {order.requiresAgeCheck && (
        <p role="alert" className="rounded-2xl bg-danger px-4 py-3 text-lg font-bold text-white">Conferir documento na entrega</p>
      )}
      {order.scheduledFor && (
        <p className="rounded-2xl bg-peach px-4 py-3 font-bold">Pedido agendado para {formatDateTime(order.scheduledFor)}</p>
      )}

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <OrderActions
          orderId={order.id} status={order.status} fulfillment={order.fulfillment}
          defaultPrepMinutes={store.prepMinutes + store.busyExtraMinutes} couriers={couriers}
          deliveryProvider={order.deliveryProvider} courierName={order.courierName}
          canRunCounter isOwner={membership.role === "owner"} autoPrint={store.autoPrint} printWidth={store.printerWidth}
        />
      </section>

      {order.deliveryProvider === "platform" && !order.courierId && ["accepted", "preparing", "ready"].includes(order.status) && (
        <section className="flex flex-col gap-2 rounded-card bg-peach p-4" data-testid="waiting-courier">
          <h2 className="text-xl">Esperando um entregador do Chegô</h2>
          <p className="text-sm">
            A entrega foi oferecida aos entregadores disponíveis. Se ninguém pegar, chame de novo ou entregue com a sua equipe.
            Quem pegar recebe da loja, por fora do app, o valor mostrado na oferta (veja em Taxas do Chegô).
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={recallCouriers}>
              <input type="hidden" name="orderId" value={order.id} />
              <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Chamar entregadores de novo</SubmitButton>
            </ActionForm>
            <ActionForm action={deliverWithOwnCourier}>
              <input type="hidden" name="orderId" value={order.id} />
              <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Entregar com a minha equipe</SubmitButton>
            </ActionForm>
          </div>
        </section>
      )}

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Cliente</h2>
        <p className="font-semibold">{order.customerName}</p>
        {order.customerPhone && (
          <p><a href={`tel:${order.customerPhone}`} className="font-bold text-brand-dark underline">{formatPhone(order.customerPhone)}</a></p>
        )}
        {order.address ? (
          <>
            <p className="mt-2">{order.address.street}, {order.address.number} · {order.address.neighborhood}</p>
            {order.address.reference && <p className="text-sm">Referência: {order.address.reference}</p>}
            {order.address.complement && <p className="text-sm">Complemento: {order.address.complement}</p>}
          </>
        ) : (
          <p className="mt-2 font-semibold">Retirada no balcão</p>
        )}
        {courier && <p className="mt-2 text-sm">Entregador: <strong>{courier.name}</strong></p>}
      </section>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Itens</h2>
        <ul>
          {order.items.map((item) => (
            <li key={item.id} data-testid="merchant-item" className="flex items-start justify-between gap-3 border-b border-cream py-2">
              <span className={item.removed ? "text-coffee-soft line-through" : ""}>
                <strong>{quantityLabel(item.quantity, item.weightStepGrams)} {item.name}</strong>
                {item.lines.map((line) => <span key={line} className="block pl-4 text-sm">{line}</span>)}
                {item.notes && <span className="block pl-4 text-sm font-semibold">Obs: {item.notes}</span>}
                {item.removed && <span className="block text-sm no-underline">Removido: {item.removedReason}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {formatCents(item.lineTotalCents)}
                {canRemove && !item.removed && <RemoveItemButton orderId={order.id} itemId={item.id} itemName={item.name} />}
              </span>
            </li>
          ))}
        </ul>
        {order.notes && <p className="mt-2 rounded-2xl bg-cream px-3 py-2 text-sm"><strong>Observação do cliente:</strong> {order.notes}</p>}
        {order.missingItemPolicy && (
          <p className="mt-2 rounded-2xl bg-cream px-3 py-2 text-sm"><strong>Se faltar um item:</strong> {MISSING_LABELS[order.missingItemPolicy]}</p>
        )}
        <div className="mt-3">
          <OrderSummary totals={order.totals} fulfillment={order.fulfillment} />
          <div className="mt-2"><PaymentLine order={order} /></div>
        </div>
        {order.refundedCents > 0 && (
          <p className="mt-2 text-sm font-bold text-danger" data-testid="merchant-refunded">Reembolsado ao cliente: {formatCents(order.refundedCents)}</p>
        )}
      </section>

      <OrderChat orderId={order.id} viewerId={profile.id} side="store"
        open={chatOpen({ paidAt: order.paidAt, completedAt: order.completedAt, status: order.status }, at)} />

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Andamento</h2>
        <OrderTimeline fulfillment={order.fulfillment} status={order.status} history={order.history} />
      </section>
    </div>
  );
}
