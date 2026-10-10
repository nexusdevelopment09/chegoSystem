import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { getSettings } from "@/lib/settings";
import { MINUTE_MS } from "@/lib/time";

export const metadata: Metadata = { title: "Pedidos ao vivo" };

export default function LivePage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Live />
    </Suspense>
  );
}

async function Live() {
  await requireRole("admin");
  const [at, settings] = await Promise.all([now(), getSettings()]);

  const orders = await sql<{
    id: string; code: string; status: OrderStatus; store_name: string; customer_name: string; total_cents: number;
    created_at: Date; paid_at: Date | null; estimated_at: Date | null; scheduled_for: Date | null; payment_status: string | null;
    ready_at: Date | null; waiting_courier: boolean;
  }[]>`
    select o.id, o.code, o.status, s.name as store_name, o.customer_name, o.total_cents, o.created_at, o.paid_at, o.estimated_at, o.scheduled_for,
           (select p.status from payments p where p.order_id = o.id order by p.created_at desc limit 1) as payment_status,
           o.ready_at, (o.delivery_provider = 'platform' and o.fulfillment = 'delivery' and o.courier_id is null) as waiting_courier
    from orders o join stores s on s.id = o.store_id
    where o.status in ('awaiting_payment', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery')
    order by o.created_at`;

  const problemOf = (order: (typeof orders)[number]): string | null => {
    if (order.status === "awaiting_payment") return order.payment_status === "declined" ? "Pagamento recusado" : null;
    if (order.status === "paid") {
      const waited = (at.getTime() - (order.paid_at?.getTime() ?? at.getTime())) / MINUTE_MS;
      if (waited >= settings.acceptance_alert_minutes) return `Sem aceite há ${Math.round(waited)} min`;
    }
    // Entrega pela rede do Chegô: pedido pronto na loja e nenhum entregador pegou.
    if (order.status === "ready" && order.waiting_courier && order.ready_at) {
      const waited = (at.getTime() - order.ready_at.getTime()) / MINUTE_MS;
      if (waited >= 5) return `Pronto há ${Math.round(waited)} min sem entregador`;
    }
    if (!order.scheduled_for && order.estimated_at && at.getTime() > order.estimated_at.getTime() + 10 * MINUTE_MS) {
      return `Atrasado ${Math.round((at.getTime() - order.estimated_at.getTime()) / MINUTE_MS)} min`;
    }
    return null;
  };
  const flagged = orders.filter((order) => problemOf(order));

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh seconds={8} />
      <h1 className="text-3xl">Pedidos em andamento</h1>

      <section role="status" data-testid="live-alerts" className={`rounded-card p-4 ${flagged.length > 0 ? "bg-danger text-white" : "bg-white ring-1 ring-peach"}`}>
        <p className="font-bold">
          {flagged.length === 0 ? "Nenhum pedido com problema agora." : `${flagged.length} pedido${flagged.length > 1 ? "s" : ""} precisando de atenção.`}
        </p>
      </section>

      <ul className="flex flex-col gap-2">
        {orders.map((order) => {
          const problem = problemOf(order);
          return (
            <li key={order.id}>
              <Link href={`/admin/pedidos/${order.id}`} data-testid="live-order" className={`flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-3 ring-2 ${problem ? "ring-danger" : "ring-peach"}`}>
                <span>
                  <strong>{order.code}</strong> · {order.store_name} · {order.customer_name}
                  <span className="block text-sm text-coffee-soft">
                    {formatDateTime(order.created_at)}{order.scheduled_for && ` · agendado para ${formatDateTime(order.scheduled_for)}`}
                  </span>
                </span>
                <span className="text-right text-sm">
                  <strong>{STATUS_LABELS[order.status]}</strong> · {formatCents(order.total_cents)}
                  {problem && <span className="block font-bold text-danger">{problem}</span>}
                </span>
              </Link>
            </li>
          );
        })}
        {orders.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum pedido em andamento.</li>}
      </ul>
    </div>
  );
}
