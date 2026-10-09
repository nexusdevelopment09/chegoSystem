import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { buttonClass } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth/session";
import { formatCents, formatDateTime } from "@/lib/format";
import { loadOrders, type OrderView } from "@/lib/orders/queries";
import { IN_PROGRESS, STATUS_LABELS } from "@/lib/orders/status";

export const metadata: Metadata = { title: "Meus pedidos" };

export default function OrdersPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <h1 className="mb-3 text-3xl">Meus pedidos</h1>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <OrdersContent />
        </Suspense>
      </main>
    </>
  );
}

function OrderCard({ order }: { order: OrderView }) {
  return (
    <li>
      <Link href={`/pedidos/${order.id}`} data-testid="order-card" className="block rounded-card bg-white p-4 shadow-sm ring-1 ring-peach hover:ring-brand">
        <p className="flex justify-between gap-3">
          <strong>{order.storeName}</strong>
          <span className="shrink-0 font-bold">{formatCents(order.totals.totalCents)}</span>
        </p>
        <p className="text-sm font-semibold text-brand-darker">{STATUS_LABELS[order.status]}</p>
        <p className="text-sm text-coffee-soft">
          {order.code} · {formatDateTime(order.createdAt)} · {order.items.reduce((total, item) => total + item.quantity, 0)} itens
        </p>
      </Link>
    </li>
  );
}

async function OrdersContent() {
  const profile = await requireUser();
  const orders = await loadOrders(profile.id, { customerId: profile.id, limit: 60 });

  if (orders.length === 0) {
    return (
      <div className="rounded-card bg-white p-8 text-center ring-1 ring-peach">
        <p className="mb-4 text-xl font-semibold">Você ainda não fez nenhum pedido.</p>
        <Link href="/" className={buttonClass("primary")}>Ver as lojas</Link>
      </div>
    );
  }

  const active = orders.filter((order) => order.status === "awaiting_payment" || IN_PROGRESS.includes(order.status));
  const past = orders.filter((order) => !active.includes(order));

  return (
    <div className="flex flex-col gap-5">
      {active.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl">Em andamento</h2>
          <ul className="flex flex-col gap-2">{active.map((order) => <OrderCard key={order.id} order={order} />)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h2 className="mb-2 text-xl">Anteriores</h2>
          <ul className="flex flex-col gap-2">{past.map((order) => <OrderCard key={order.id} order={order} />)}</ul>
        </section>
      )}
    </div>
  );
}
