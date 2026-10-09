"use client";

import { acceptOrder, advanceOrder, deliverOrder, rejectOrder, removeMissingItem } from "@/app/lojista/actions";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { inputClass } from "@/components/ui/Field";
import { REJECT_REASONS, type Fulfillment, type OrderStatus } from "@/lib/orders/status";

const small = "min-h-11 px-4 text-sm";

type Props = {
  orderId: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  defaultPrepMinutes: number;
  couriers: { id: string; name: string }[];
  canRunCounter: boolean;
  isOwner: boolean;
  autoPrint: boolean;
  printWidth: number;
};

/** The buttons that move an order forward, according to where it is. */
export function OrderActions(props: Props) {
  const { orderId, status, fulfillment, couriers } = props;
  if (!props.canRunCounter) return null;
  const id = <input type="hidden" name="orderId" value={orderId} />;

  if (status === "paid") {
    return (
      <div className="flex flex-col gap-2">
        <ActionForm
          action={acceptOrder}
          className="flex flex-wrap items-end gap-2"
          onSuccess={props.autoPrint ? () => window.open(`/lojista/pedidos/${orderId}/imprimir?l=${props.printWidth}`, "_blank") : undefined}
        >
          {id}
          <label className="flex flex-col text-xs font-semibold">
            Preparo (min)
            <input name="prepMinutes" type="number" min={1} max={600} defaultValue={props.defaultPrepMinutes} className={`${inputClass} w-24`} />
          </label>
          <SubmitButton className={small}>Aceitar</SubmitButton>
        </ActionForm>

        <details>
          <summary className="min-h-11 cursor-pointer text-sm font-bold text-danger underline">Recusar pedido</summary>
          <ActionForm action={rejectOrder} className="mt-1 flex flex-col gap-2">
            {id}
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Motivo
              <select name="reason" required defaultValue="" className={inputClass}>
                <option value="" disabled>Escolha o motivo</option>
                {REJECT_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Detalhe (obrigatório em “Outro”)
              <input name="detail" maxLength={200} className={inputClass} />
            </label>
            <SubmitButton variant="secondary" className={small}>Confirmar recusa e reembolsar</SubmitButton>
          </ActionForm>
        </details>
      </div>
    );
  }

  if (status === "accepted" || status === "preparing") {
    return (
      <ActionForm action={advanceOrder}>
        {id}
        <input type="hidden" name="to" value={status === "accepted" ? "preparing" : "ready"} />
        <SubmitButton className={small}>{status === "accepted" ? "Começar o preparo" : "Marcar como pronto"}</SubmitButton>
      </ActionForm>
    );
  }

  if (status === "ready" && fulfillment === "pickup") {
    return (
      <ActionForm action={advanceOrder}>
        {id}
        <input type="hidden" name="to" value="picked_up" />
        <SubmitButton className={small}>Cliente retirou</SubmitButton>
      </ActionForm>
    );
  }

  if (status === "ready") {
    return (
      <ActionForm action={advanceOrder} className="flex flex-wrap items-end gap-2">
        {id}
        <input type="hidden" name="to" value="out_for_delivery" />
        <label className="flex flex-col text-xs font-semibold">
          Entregador
          <select name="courierId" defaultValue={couriers[0]?.id ?? ""} className={inputClass}>
            <option value="">Sem entregador no sistema</option>
            {couriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
          </select>
        </label>
        <SubmitButton className={small}>Saiu para entrega</SubmitButton>
      </ActionForm>
    );
  }

  if (status === "out_for_delivery") {
    return (
      <ActionForm action={deliverOrder} className="flex flex-col gap-2">
        {id}
        <label className="flex flex-col text-xs font-semibold">
          Código de entrega do cliente
          <input name="code" inputMode="numeric" maxLength={4} pattern="\d{4}" placeholder="0000" className={`${inputClass} w-28 text-center text-lg tracking-widest`} />
        </label>
        {props.isOwner && (
          <label className="flex flex-col text-xs font-semibold">
            Sem código? Diga o motivo (só o dono da loja)
            <input name="reason" maxLength={200} className={inputClass} />
          </label>
        )}
        <SubmitButton className={small}>Marcar como entregue</SubmitButton>
      </ActionForm>
    );
  }

  return null;
}

/** "Em falta" button next to an item, while the order is being prepared. */
export function RemoveItemButton({ orderId, itemId, itemName }: { orderId: string; itemId: string; itemName: string }) {
  return (
    <ActionForm action={removeMissingItem}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="itemId" value={itemId} />
      <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs" >
        <span aria-label={`Marcar ${itemName} como em falta e reembolsar`}>Em falta</span>
      </SubmitButton>
    </ActionForm>
  );
}
