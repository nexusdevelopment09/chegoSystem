import { formatDateTime } from "@/lib/format";
import { STATUS_LABELS, type Fulfillment, type OrderStatus } from "@/lib/orders/status";

const FLOW: Record<Fulfillment, OrderStatus[]> = {
  delivery: ["awaiting_payment", "paid", "accepted", "preparing", "ready", "out_for_delivery", "delivered"],
  pickup: ["awaiting_payment", "paid", "accepted", "preparing", "ready", "picked_up"],
};

type Props = {
  fulfillment: Fulfillment;
  status: OrderStatus;
  history: { status: OrderStatus; reason: string | null; at: Date }[];
};

/** The order's steps, with the time each one happened and what is still to come. */
export function OrderTimeline({ fulfillment, status, history }: Props) {
  const done = new Map(history.map((entry) => [entry.status, entry]));
  const offFlow = history.filter((entry) => !FLOW[fulfillment].includes(entry.status));
  const stopped = offFlow.length > 0;
  // After a cancellation or refusal the steps that never happened are not shown.
  const steps = FLOW[fulfillment].filter((step) => done.has(step) || !stopped);

  return (
    <ol className="flex flex-col" data-testid="order-timeline">
      {[...steps.map((step) => ({ step, entry: done.get(step) })), ...offFlow.map((entry) => ({ step: entry.status, entry }))].map(({ step, entry }, index, all) => {
        const current = step === status;
        return (
          <li key={`${step}-${index}`} className="flex gap-3" aria-current={current ? "step" : undefined}>
            <div className="flex flex-col items-center">
              <span className={`mt-1 size-4 shrink-0 rounded-full border-2 ${entry ? "border-brand-dark bg-brand-dark" : "border-peach bg-white"} ${current ? "ring-4 ring-peach" : ""}`} />
              {index < all.length - 1 && <span className={`w-0.5 flex-1 ${entry ? "bg-brand-dark" : "bg-peach"}`} />}
            </div>
            <div className="pb-4">
              <p className={entry ? (current ? "font-bold" : "font-semibold") : "text-coffee-soft"}>{STATUS_LABELS[step]}</p>
              {entry && <p className="text-sm text-coffee-soft">{formatDateTime(entry.at)}</p>}
              {entry?.reason && <p className="text-sm text-coffee-soft">Motivo: {entry.reason}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
