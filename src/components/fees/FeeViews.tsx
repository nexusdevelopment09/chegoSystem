import Link from "next/link";
import type { Closing, ClosingStatus } from "@/lib/fees/closing";
import type { FeeEntryKind } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";

// Peças das telas de taxas do Chegô, as mesmas para a loja e para o admin.

export const CLOSING_STATUS_LABELS: Record<ClosingStatus, string> = {
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago",
  overdue: "Vencido",
  in_review: "Em análise",
};

export const FEE_ENTRY_LABELS: Record<FeeEntryKind, string> = {
  order_fee: "Taxa do pedido",
  order_fee_reversal: "Estorno da taxa",
  coupon_credit: "Crédito de cupom do Chegô",
  coupon_credit_reversal: "Estorno de crédito de cupom",
  adjustment: "Ajuste",
  carryover: "Saldo de outro fechamento",
};

/** "09/10/2026" a partir de "2026-10-09". */
export const formatDay = (date: string) => date.split("-").reverse().join("/");

export function ClosingStatusBadge({ status }: { status: ClosingStatus }) {
  const tone =
    status === "paid" ? "bg-success text-white" : status === "overdue" ? "bg-danger text-white" : status === "in_review" ? "bg-coffee text-white" : "bg-peach text-brand-darker";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone}`} data-testid="closing-status">{CLOSING_STATUS_LABELS[status]}</span>;
}

/** Os números de um fechamento, na ordem da conta. */
export function ClosingTotals({ closing }: { closing: Closing }) {
  const row = "flex justify-between gap-3 py-1";
  return (
    <dl className="text-base" data-testid="closing-totals">
      <div className={row}><dt>Pedidos concluídos</dt><dd>{closing.order_count}</dd></div>
      <div className={row}><dt>Taxa por pedido</dt><dd>{formatCents(closing.fee_unit_cents)}</dd></div>
      <div className={row}><dt>Taxas</dt><dd>{formatCents(closing.fees_cents)}</dd></div>
      {closing.credits_cents !== 0 && <div className={`${row} text-success`}><dt>Créditos de cupons do Chegô</dt><dd>{formatCents(closing.credits_cents)}</dd></div>}
      {closing.adjustments_cents !== 0 && <div className={row}><dt>Ajustes e saldos</dt><dd>{formatCents(closing.adjustments_cents)}</dd></div>}
      <div className={`${row} mt-1 border-t border-peach pt-2 text-xl font-bold`}>
        <dt>Total a pagar</dt><dd data-testid="closing-due">{formatCents(closing.total_due_cents)}</dd>
      </div>
    </dl>
  );
}

type Entry = { id: string; kind: FeeEntryKind; amount_cents: number; business_date: string; order_id: string | null; order_code: string | null; reason: string | null };

/** Cada lançamento que compõe um fechamento (ou o expediente em aberto). */
export function FeeEntries({ entries, orderHref }: { entries: Entry[]; orderHref?: (orderId: string) => string }) {
  if (entries.length === 0) return <p className="text-sm text-coffee-soft">Nenhum lançamento.</p>;
  return (
    <ul className="divide-y divide-cream text-sm" data-testid="fee-entries">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
          <span className="min-w-0">
            <span className="font-semibold">{FEE_ENTRY_LABELS[entry.kind]}</span>
            {entry.order_code && entry.order_id && (
              <> · {orderHref ? <Link href={orderHref(entry.order_id)} className="text-brand-dark underline">{entry.order_code}</Link> : entry.order_code}</>
            )}
            <span className="text-coffee-soft"> · {formatDay(entry.business_date)}</span>
            {entry.reason && <span className="block text-coffee-soft">{entry.reason}</span>}
          </span>
          <span className={entry.amount_cents < 0 ? "font-semibold text-success" : "font-semibold"}>{formatCents(entry.amount_cents)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Uma linha do histórico de fechamentos. */
export function ClosingRow({ closing, href, storeName }: { closing: Closing; href: string; storeName?: string }) {
  return (
    <li>
      <Link href={href} data-testid="closing-row" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 ring-1 ring-peach transition hover:ring-brand">
        <span className="min-w-0">
          <span className="font-semibold">{storeName ? `${storeName} · ` : ""}Expediente de {formatDay(closing.business_date)}</span>
          <span className="block text-sm text-coffee-soft">
            {closing.order_count} pedido{closing.order_count === 1 ? "" : "s"} · fechado em {formatDateTime(closing.closed_at)} · vence {formatDay(closing.due_date)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <strong>{formatCents(closing.total_due_cents)}</strong>
          <ClosingStatusBadge status={closing.status} />
        </span>
      </Link>
    </li>
  );
}
