import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { z } from "zod";
import { payWithCard, simulateMyPayment } from "@/app/pedidos/actions";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AutoRefresh } from "@/components/orders/AutoRefresh";
import { PixBox } from "@/components/orders/PixBox";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { requireUser } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { withUser } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { loadOrder } from "@/lib/orders/queries";
import { isMockPayments } from "@/lib/payments";

export const metadata: Metadata = { title: "Pagamento" };

type Params = Promise<{ id: string }>;

export default function PaymentPage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <PaymentContent params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function PaymentContent({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const profile = await requireUser();
  const order = await loadOrder(profile.id, id);
  if (!order || order.customerId !== profile.id) notFound();
  // Pago (ou encerrado de outro jeito): a página de acompanhamento assume.
  if (order.status !== "awaiting_payment") redirect(`/pedidos/${order.id}`);

  const [payment] = await withUser(profile.id, (tx) => tx<{ status: string; method: string; pix_copy_paste: string | null }[]>`
    select status, method, pix_copy_paste from payments where order_id = ${order.id} order by created_at desc limit 1`);
  const at = await now();
  const secondsLeft = Math.max(0, Math.round(((order.paymentExpiresAt?.getTime() ?? at.getTime()) - at.getTime()) / 1000));
  const declined = payment?.status === "declined";

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh seconds={3} />
      <h1 className="text-3xl">Pagamento do pedido {order.code}</h1>

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
        {declined ? (
          <div role="alert" data-testid="payment-declined">
            <p className="text-xl font-bold text-danger">Pagamento recusado.</p>
            <p className="text-coffee-soft">Eita, o banco não aprovou. Você pode tentar de novo com outro cartão ou pagar com Pix.</p>
          </div>
        ) : payment?.method === "pix" && isMockPayments() && !isLocalEnv ? (
          // O código do Pix simulado não é um Pix de verdade: mostrá-lo faria alguém tentar pagar no banco.
          <div role="status" data-testid="mock-pix-note">
            <p className="text-xl font-bold">Pix de teste</p>
            <p className="text-coffee-soft">Não pague nada no banco. Use o botão “Simular pagamento aprovado” logo abaixo.</p>
          </div>
        ) : payment?.method === "pix" && payment.pix_copy_paste ? (
          <PixBox
            qrSvg={await QRCode.toString(payment.pix_copy_paste, { type: "svg", margin: 1, width: 220 })}
            code={payment.pix_copy_paste}
            secondsLeft={secondsLeft}
          />
        ) : (
          <p role="status" className="text-lg">Estamos confirmando seu pagamento com o banco...</p>
        )}
        <p className="mt-4 text-center text-sm text-coffee-soft">
          Assim que o pagamento for confirmado, o pedido vai para a {order.storeName} e esta página muda sozinha.
        </p>
      </section>

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
        <OrderSummary totals={order.totals} fulfillment={order.fulfillment} />
      </section>

      <details className="rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
        <summary className="min-h-11 cursor-pointer text-lg font-bold text-brand-dark">Pagar com cartão de crédito</summary>
        <form action={payWithCard} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="orderId" value={order.id} />
          {isMockPayments() && <p className="text-sm text-coffee-soft">Pagamento de teste, nenhum valor é cobrado: final 0000 aprova, final 1111 recusa.</p>}
          <Field label="Número do cartão" name="number" inputMode="numeric" autoComplete="cc-number" maxLength={23} required />
          <Field label="Nome no cartão" name="holder" autoComplete="cc-name" maxLength={60} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Validade (MM/AA)" name="expiry" autoComplete="cc-exp" maxLength={5} placeholder="12/30" required />
            <Field label="Código de segurança" name="cvv" inputMode="numeric" autoComplete="cc-csc" maxLength={4} required />
          </div>
          <Button type="submit">Pagar com cartão</Button>
        </form>
      </details>

      {isMockPayments() && (
        <section className="rounded-card bg-peach p-4" data-testid="payment-simulator">
          <p className="mb-1 text-sm font-bold">Pagamento de teste</p>
          <p className="mb-3 text-sm">O Chegô ainda está em testes: nenhum dinheiro é cobrado pelo app. Confirme abaixo para o pedido seguir para a loja.</p>
          <form action={simulateMyPayment} className="flex flex-wrap gap-2">
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" name="outcome" value="approve" className="min-h-11 px-4 text-sm">Simular pagamento aprovado</Button>
            {isLocalEnv && (
              <>
                <Button type="submit" name="outcome" value="decline" variant="secondary" className="min-h-11 px-4 text-sm">Simular recusa</Button>
                <Button type="submit" name="outcome" value="expire" variant="secondary" className="min-h-11 px-4 text-sm">Simular expiração</Button>
              </>
            )}
          </form>
        </section>
      )}

      <Link href={`/pedidos/${order.id}`} className={buttonClass("secondary")}>Ver o pedido</Link>
    </div>
  );
}
