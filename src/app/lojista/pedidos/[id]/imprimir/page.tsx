import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PrintOnLoad } from "@/components/merchant/PrintOnLoad";
import { paymentText } from "@/components/orders/PaymentLine";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { loadOrder } from "@/lib/orders/queries";
import { quantityLabel } from "@/lib/catalog/weight";

export const metadata: Metadata = { title: "Imprimir pedido" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ l?: string }> };

// Comprovante para impressoras térmicas. ?l=58 ou ?l=80 escolhe a largura do papel em milímetros.
export default function PrintPage(props: Props) {
  return (
    <Suspense fallback={<p>Carregando...</p>}>
      <Ticket {...props} />
    </Suspense>
  );
}

const Line = () => <hr className="my-1 border-t border-dashed border-black" />;

async function Ticket({ params, searchParams }: Props) {
  const [{ id }, { l }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();

  const { profile, store } = await getMerchantContext(["owner", "attendant"]);
  const order = await loadOrder(profile.id, id);
  if (!order || order.storeId !== store.id) notFound();

  const width = l === "58" ? 58 : 80;
  const row = "flex justify-between gap-2";

  return (
    <div
      data-testid="ticket"
      className="mx-auto bg-white p-2 font-mono text-black"
      style={{ width: `${width}mm`, fontSize: width === 58 ? "11px" : "13px", lineHeight: 1.25 }}
    >
      {/* Tamanho do papel e nenhuma margem do navegador, para nada ser cortado na bobina. */}
      <style>{`@page { size: ${width}mm auto; margin: 0 } @media print { body { background: #fff } }`}</style>
      <PrintOnLoad />

      <p className="text-center text-base font-bold">{store.name}</p>
      <p className="text-center">Pedido {order.code}</p>
      <p className="text-center">{formatDateTime(order.createdAt)}</p>
      <Line />

      <p className="font-bold">{order.fulfillment === "delivery" ? "ENTREGA" : "RETIRADA NO BALCÃO"}</p>
      {order.scheduledFor && <p className="font-bold">AGENDADO: {formatDateTime(order.scheduledFor)}</p>}
      <p>{order.customerName}</p>
      {order.customerPhone && <p>{formatPhone(order.customerPhone)}</p>}
      {order.address && (
        <>
          <p>{order.address.street}, {order.address.number}</p>
          <p>{order.address.neighborhood}</p>
          {order.address.reference && <p>Ref: {order.address.reference}</p>}
          {order.address.complement && <p>Compl: {order.address.complement}</p>}
        </>
      )}
      {order.requiresAgeCheck && <p className="mt-1 border border-black p-1 text-center font-bold">CONFERIR DOCUMENTO NA ENTREGA</p>}
      <Line />

      {order.items.filter((item) => !item.removed).map((item) => (
        <div key={item.id} className="mb-1">
          <p className={`${row} font-bold`}>
            <span>{quantityLabel(item.quantity, item.weightStepGrams)} {item.name}</span>
            <span>{formatCents(item.lineTotalCents)}</span>
          </p>
          {item.lines.map((line) => <p key={line} className="pl-3">{line}</p>)}
          {item.notes && <p className="pl-3">Obs: {item.notes}</p>}
        </div>
      ))}
      {order.notes && <p className="font-bold">Obs do pedido: {order.notes}</p>}
      <Line />

      <p className={row}><span>Subtotal</span><span>{formatCents(order.totals.subtotalCents)}</span></p>
      {order.totals.discountCents > 0 && <p className={row}><span>Desconto</span><span>-{formatCents(order.totals.discountCents)}</span></p>}
      <p className={row}><span>Entrega</span><span>{formatCents(order.totals.deliveryFeeCents)}</span></p>
      {order.totals.serviceFeeCents > 0 && <p className={row}><span>Taxa de serviço</span><span>{formatCents(order.totals.serviceFeeCents)}</span></p>}
      <p className={`${row} text-base font-bold`}><span>TOTAL</span><span>{formatCents(order.totals.totalCents)}</span></p>
      <p className="font-bold">{paymentText(order)}</p>
      <Line />
      <p className="text-center">Chegô · Pediu, Chegô.</p>
    </div>
  );
}
