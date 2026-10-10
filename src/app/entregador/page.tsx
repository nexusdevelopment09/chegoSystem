import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button, buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { Stat } from "@/components/ui/Stats";
import { listOffers, MAX_ACTIVE_DELIVERIES, pickupPlaces, requireCourier } from "@/lib/couriers";
import { withUser } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { COURIER_KIND_LABELS, VEHICLE_LABELS } from "@/lib/labels";
import { loadOrders } from "@/lib/orders/queries";
import { STATUS_LABELS } from "@/lib/orders/status";
import { claimDelivery, completeDelivery, pickUpDelivery, releaseDelivery, setAvailability } from "./actions";

export const metadata: Metadata = { title: "Minhas entregas" };

const card = "flex flex-col gap-2 rounded-card bg-white p-4 shadow-sm ring-1 ring-peach";
const small = "min-h-11 px-4 text-sm";

export default function CourierPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-10">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <Panel />
        </Suspense>
      </main>
    </>
  );
}

const mapLink = (text: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

async function Panel() {
  const { profile, courier } = await requireCourier();

  if (courier.status !== "active") {
    return (
      <>
        <h1 className="text-3xl">Oi, {profile.fullName.split(" ")[0]}!</h1>
        <div className={card} data-testid="courier-waiting">
          {courier.status === "pending" ? (
            <>
              <p className="text-xl font-semibold">Seu cadastro está em análise.</p>
              <p className="text-coffee-soft">A equipe do Chegô confere os seus dados e avisa por aqui quando você puder começar a entregar.</p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold text-danger">Seu cadastro está bloqueado.</p>
              <p className="text-coffee-soft">{courier.blockedReason ?? "Fale com o suporte do Chegô para saber o motivo."}</p>
            </>
          )}
        </div>
      </>
    );
  }

  // As entregas do entregador são lidas como ele: as regras de acesso por linha (RLS)
  // só devolvem os pedidos pagos em que ele é o entregador. As ofertas não têm dono
  // ainda, então vêm de uma consulta própria, sem os dados do cliente.
  const [mine, offers, earnings] = await Promise.all([
    loadOrders(profile.id, { courierId: profile.id, statuses: ["accepted", "preparing", "ready", "out_for_delivery"] }),
    courier.available ? listOffers(courier.cityId) : Promise.resolve([]),
    withUser(profile.id, (tx) => tx<{ id: string; code: string; store: string; amount_cents: number; paid_at: Date | null; created_at: Date }[]>`
      select e.id, o.code, s.name as store, e.amount_cents, e.paid_at, e.created_at
      from courier_earnings e join orders o on o.id = e.order_id join stores s on s.id = o.store_id
      where e.courier_id = ${profile.id}
      order by e.created_at desc limit 30`),
  ]);
  const places = await pickupPlaces(mine.map((order) => order.id));
  const toReceive = earnings.filter((row) => !row.paid_at).reduce((total, row) => total + row.amount_cents, 0);
  const received = earnings.filter((row) => row.paid_at).reduce((total, row) => total + row.amount_cents, 0);
  const full = mine.length >= MAX_ACTIVE_DELIVERIES;

  return (
    <>
      <AutoRefresh seconds={6} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-3xl">Oi, {profile.fullName.split(" ")[0]}!</h1>
          <p className="text-sm text-coffee-soft">{COURIER_KIND_LABELS[courier.kind]} · {VEHICLE_LABELS[courier.vehicle]} · {courier.cityName}</p>
        </div>
        <form action={setAvailability}>
          {!courier.available && <input type="hidden" name="available" value="on" />}
          <Button type="submit" variant={courier.available ? "secondary" : "primary"} data-testid="courier-availability" aria-pressed={courier.available}>
            {courier.available ? "Parar por agora" : "Ficar disponível"}
          </Button>
        </form>
      </header>

      <p role="status" className={`rounded-2xl px-3 py-2 font-semibold ${courier.available ? "bg-cream text-success" : "bg-peach text-brand-darker"}`}>
        {courier.available ? "Você está disponível: as entregas novas aparecem aqui." : "Você está parado. Toque em “Ficar disponível” para receber entregas."}
      </p>

      <section className="flex flex-col gap-2" aria-labelledby="minhas">
        <h2 id="minhas" className="text-2xl">Minhas entregas</h2>
        {mine.length === 0 && <p className={`${card} text-center text-coffee-soft`}>Nenhuma entrega com você agora.</p>}
        {mine.map((order) => {
          const address = order.address;
          const place = places.get(order.id) ?? "";
          const onTheWay = order.status === "out_for_delivery";
          return (
            <article key={order.id} data-testid="courier-delivery" className={card}>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl">{order.code}</h3>
                <span className="rounded-full bg-cream px-3 py-1 text-sm font-bold">{onTheWay ? "Com você, a caminho do cliente" : STATUS_LABELS[order.status]}</span>
              </header>

              {order.requiresAgeCheck && <p role="alert" className="rounded-2xl bg-danger px-3 py-2 font-bold text-white">Conferir documento na entrega</p>}

              {!onTheWay ? (
                <>
                  <p><span className="text-sm text-coffee-soft">Retirar em</span><br /><strong>{order.storeName}</strong><br />{place}</p>
                  <div className="flex flex-wrap gap-2">
                    <a href={mapLink(`${order.storeName}, ${place}`)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", small)}>Abrir a loja no mapa</a>
                  </div>
                  {order.status === "ready" ? (
                    <ActionForm action={pickUpDelivery}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <SubmitButton>Retirei o pedido</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="rounded-2xl bg-peach px-3 py-2 text-sm font-semibold">A loja ainda está preparando. O botão de retirar aparece quando o pedido ficar pronto.</p>
                  )}
                  <ActionForm action={releaseDelivery}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <SubmitButton variant="secondary" className={small}>Desistir desta entrega</SubmitButton>
                  </ActionForm>
                </>
              ) : (
                <>
                  <p className="font-semibold">{order.customerName}</p>
                  {address && (
                    <>
                      <p>{address.street}, {address.number} · {address.neighborhood}</p>
                      {address.reference && <p className="rounded-2xl bg-peach px-3 py-2 font-semibold">Referência: {address.reference}</p>}
                      {address.complement && <p className="text-sm">Complemento: {address.complement}</p>}
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {address && (
                      <a href={mapLink(`${address.street}, ${address.number}, ${address.neighborhood}, ${address.city}`)} target="_blank" rel="noopener noreferrer"
                        className={buttonClass("secondary", small)}>Abrir no mapa</a>
                    )}
                    {order.customerPhone && <a href={`tel:${order.customerPhone}`} className={buttonClass("secondary", small)}>Ligar: {formatPhone(order.customerPhone)}</a>}
                  </div>
                  <ActionForm action={completeDelivery} className="mt-1 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <label className="flex flex-col text-sm font-semibold">
                      Código de entrega (peça ao cliente)
                      <input name="code" inputMode="numeric" maxLength={4} pattern="\d{4}" required placeholder="0000" className={`${inputClass} w-32 text-center text-xl tracking-widest`} />
                    </label>
                    <SubmitButton>Entreguei</SubmitButton>
                  </ActionForm>
                </>
              )}
            </article>
          );
        })}
      </section>

      {courier.available && (
        <section className="flex flex-col gap-2" aria-labelledby="ofertas">
          <h2 id="ofertas" className="text-2xl">Entregas disponíveis</h2>
          {full && <p className="rounded-2xl bg-peach px-3 py-2 text-sm font-semibold">Você já está com {MAX_ACTIVE_DELIVERIES} entregas. Conclua uma para pegar outra.</p>}
          {offers.length === 0 && <p className={`${card} text-center text-coffee-soft`}>Nenhuma entrega esperando agora. Já já aparece.</p>}
          {offers.map((offer) => (
            <article key={offer.id} data-testid="courier-offer" className={card}>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl">{offer.storeName}</h3>
                <span className="font-display text-xl font-semibold text-success">Você ganha {formatCents(offer.feeCents)}</span>
              </header>
              <p className="text-sm"><span className="text-coffee-soft">Retirar em</span> {offer.storeAddress}</p>
              <p className="text-sm"><span className="text-coffee-soft">Entregar em</span> <strong>{offer.destination}</strong></p>
              <p className="text-sm text-coffee-soft">
                Pedido {offer.code} · {offer.status === "ready" ? "já está pronto" : "a loja está preparando"}
                {offer.requiresAgeCheck && " · conferir documento na entrega"}
              </p>
              <ActionForm action={claimDelivery}>
                <input type="hidden" name="orderId" value={offer.id} />
                <SubmitButton className={full ? "opacity-60" : ""}>Pegar entrega</SubmitButton>
              </ActionForm>
            </article>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="ganhos">
        <h2 id="ganhos" className="text-2xl">Meus ganhos</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="A receber" value={formatCents(toReceive)} hint="O Chegô repassa as entregas concluídas" />
          <Stat label="Já recebido" value={formatCents(received)} />
        </div>
        {earnings.length > 0 && (
          <ul className={`${card} gap-0 text-sm`}>
            {earnings.map((row) => (
              <li key={row.id} data-testid="courier-earning" className="flex flex-wrap justify-between gap-2 border-b border-cream py-2 last:border-0">
                <span className="min-w-0"><strong>{row.code}</strong> · {row.store}<span className="block text-coffee-soft">{formatDateTime(row.created_at)}</span></span>
                <span className="text-right font-semibold tabular-nums">
                  {formatCents(row.amount_cents)}
                  <span className={`block text-xs font-bold ${row.paid_at ? "text-success" : "text-coffee-soft"}`}>{row.paid_at ? "Repassado" : "A receber"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
