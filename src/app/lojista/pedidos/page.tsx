import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Countdown } from "@/components/merchant/Countdown";
import { NewOrderAlert } from "@/components/merchant/NewOrderAlert";
import { OrderActions } from "@/components/merchant/OrderActions";
import { StoreControls } from "@/components/merchant/StoreControls";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext, getTeam } from "@/lib/merchant/context";
import { loadOrders, type OrderView } from "@/lib/orders/queries";
import type { OrderStatus } from "@/lib/orders/status";
import { getSettings } from "@/lib/settings";
import { fromLocal, MINUTE_MS, toLocal } from "@/lib/time";

export const metadata: Metadata = { title: "Pedidos da loja" };

const COLUMNS: { title: string; statuses: OrderStatus[] }[] = [
  { title: "Novos", statuses: ["paid"] },
  { title: "Em preparo", statuses: ["accepted", "preparing"] },
  { title: "Prontos", statuses: ["ready"] },
  { title: "Em entrega", statuses: ["out_for_delivery"] },
  { title: "Concluídos hoje", statuses: ["delivered", "picked_up", "partially_refunded"] },
];

export default function MerchantOrdersPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <OrdersBoard />
    </Suspense>
  );
}

async function OrdersBoard() {
  const { profile, membership, store, at } = await getMerchantContext(["owner", "attendant"]);
  const [settings, team] = await Promise.all([getSettings(), getTeam(store.id)]);
  const startOfDay = fromLocal(toLocal(at).date, 0);

  // Loaded as this user: Row Level Security only returns paid orders of their store.
  const [open, doneToday] = await Promise.all([
    loadOrders(profile.id, { storeId: store.id, statuses: ["paid", "accepted", "preparing", "ready", "out_for_delivery"] }),
    loadOrders(profile.id, { storeId: store.id, statuses: ["delivered", "picked_up", "partially_refunded"], since: startOfDay, limit: 30 }),
  ]);
  const orders = [...open, ...doneToday];

  const waiting = orders.filter((order) => order.status === "paid");
  const waitedMinutes = (order: OrderView) => (at.getTime() - (order.paidAt?.getTime() ?? at.getTime())) / MINUTE_MS;
  const urgent = waiting.some((order) => waitedMinutes(order) >= settings.acceptance_alert_minutes);
  const couriers = team.filter((member) => member.role === "courier").map((member) => ({ id: member.id, name: member.name }));

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh seconds={4} />
      <NewOrderAlert waiting={waiting.length} urgent={urgent} />
      <StoreControls store={store} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((column) => {
          const inColumn = orders.filter((order) => column.statuses.includes(order.status));
          return (
            <section key={column.title} aria-label={column.title} data-testid={`column-${column.title}`} className="flex flex-col gap-2 rounded-card bg-peach/50 p-3">
              <h2 className="flex items-center justify-between text-lg">
                {column.title}
                <span className="rounded-full bg-white px-2 text-sm font-bold">{inColumn.length}</span>
              </h2>
              {inColumn.length === 0 && <p className="text-sm text-coffee-soft">Nada por aqui.</p>}
              {inColumn.map((order) => {
                const secondsToReject = Math.round((settings.auto_reject_minutes - waitedMinutes(order)) * 60);
                return (
                  <article key={order.id} data-testid="merchant-order" className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-peach">
                    <header className="flex items-start justify-between gap-2">
                      <Link href={`/lojista/pedidos/${order.id}`} className="font-display text-lg font-semibold text-brand-dark underline">
                        {order.code}
                      </Link>
                      <span className="text-sm font-bold">{formatCents(order.totals.totalCents)}</span>
                    </header>
                    <p className="text-sm">
                      {order.customerName} · {order.fulfillment === "delivery" ? `Entrega em ${order.address?.neighborhood ?? ""}` : "Retirada"}
                    </p>
                    {order.status === "paid" && <Countdown seconds={secondsToReject} label="Aceite em" />}
                    {order.scheduledFor && <p className="text-sm font-bold text-brand-darker">Agendado: {formatDateTime(order.scheduledFor)}</p>}
                    {order.requiresAgeCheck && <p className="rounded-xl bg-peach px-2 py-1 text-sm font-bold text-danger">Conferir documento na entrega</p>}
                    <ul className="text-sm text-coffee-soft">
                      {order.items.filter((item) => !item.removed).map((item) => (
                        <li key={item.id}>
                          {item.quantity}x {item.name}
                          {item.lines.map((line) => <span key={line} className="block pl-3">{line}</span>)}
                          {item.notes && <span className="block pl-3 font-semibold text-coffee">Obs: {item.notes}</span>}
                        </li>
                      ))}
                    </ul>
                    <OrderActions
                      orderId={order.id} status={order.status} fulfillment={order.fulfillment}
                      defaultPrepMinutes={store.prepMinutes + store.busyExtraMinutes} couriers={couriers}
                      canRunCounter isOwner={membership.role === "owner"} autoPrint={store.autoPrint} printWidth={store.printerWidth}
                    />
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
