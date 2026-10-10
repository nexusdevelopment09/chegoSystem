import type { Metadata } from "next";
import { Suspense } from "react";
import { deliverOrder } from "@/app/lojista/actions";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { formatCents, formatPhone } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { loadOrders } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Minhas entregas" };

export default function DeliveriesPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Deliveries />
    </Suspense>
  );
}

async function Deliveries() {
  const { profile, membership, store } = await getMerchantContext(["owner", "attendant", "courier"]);

  // O entregador só vê (e as regras de acesso por linha só devolvem) as próprias entregas.
  const orders = await loadOrders(profile.id, {
    storeId: store.id,
    statuses: ["out_for_delivery"],
    courierId: membership.role === "courier" ? profile.id : undefined,
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <AutoRefresh seconds={6} />
      <h1 className="text-3xl">{membership.role === "courier" ? "Minhas entregas" : "Entregas na rua"}</h1>

      {orders.length === 0 && (
        <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma entrega na rua agora.</p>
      )}

      {orders.map((order) => {
        const address = order.address;
        const map = address
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address.street}, ${address.number}, ${address.neighborhood}, ${address.city}`)}`
          : null;
        return (
          <article key={order.id} data-testid="delivery" className="flex flex-col gap-2 rounded-card bg-white p-4 shadow-sm ring-1 ring-peach">
            <header className="flex justify-between gap-3">
              <h2 className="text-xl">{order.code}</h2>
              <span className="font-bold">{formatCents(order.totals.totalCents)} · já pago</span>
            </header>

            {order.requiresAgeCheck && (
              <p role="alert" className="rounded-2xl bg-danger px-3 py-2 font-bold text-white">Conferir documento na entrega</p>
            )}

            <p className="font-semibold">{order.customerName}</p>
            {address && (
              <>
                <p>{address.street}, {address.number} · {address.neighborhood}</p>
                {address.reference && <p className="rounded-2xl bg-peach px-3 py-2 font-semibold">Referência: {address.reference}</p>}
                {address.complement && <p className="text-sm">Complemento: {address.complement}</p>}
              </>
            )}

            <div className="flex flex-wrap gap-2">
              {map && <a href={map} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Abrir no mapa</a>}
              {order.customerPhone && (
                <a href={`tel:${order.customerPhone}`} className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
                  Ligar: {formatPhone(order.customerPhone)}
                </a>
              )}
            </div>

            <ActionForm action={deliverOrder} className="mt-1 flex flex-wrap items-end gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <label className="flex flex-col text-sm font-semibold">
                Código de entrega (peça ao cliente)
                <input name="code" inputMode="numeric" maxLength={4} pattern="\d{4}" required={membership.role !== "owner"} placeholder="0000"
                  className={`${inputClass} w-32 text-center text-xl tracking-widest`} />
              </label>
              {membership.role === "owner" && (
                <label className="flex flex-1 flex-col text-sm font-semibold">
                  Sem código? Diga o motivo
                  <input name="reason" maxLength={200} className={inputClass} />
                </label>
              )}
              <SubmitButton>Entreguei</SubmitButton>
            </ActionForm>
          </article>
        );
      })}
    </div>
  );
}
