import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { hasPermission } from "@/lib/auth/session";
import { productStatus } from "@/lib/catalog/availability";
import { loadProducts } from "@/lib/catalog/queries";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { billTotals } from "@/lib/tables/rules";
import { addPayment, cancelItem, cancelPayment, cancelTableBill, closeTableBill } from "../../actions";
import { BillItemForm, type BillProduct } from "./BillItemForm";

export const metadata: Metadata = { title: "Conta" };

const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;
const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";

export default function BillPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando conta" />}>
      <Bill params={params} />
    </Suspense>
  );
}

async function Bill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { membership, store, at } = await getMerchantContext("vendas.presenciais");
  const [bill] = await sql<{ id: string; label: string; customer_name: string | null; status: "aberta" | "fechada" | "cancelada"; opened_at: Date; closed_at: Date | null; order_id: string | null; code: string | null; opened_name: string; closed_name: string | null; cancel_reason: string | null }[]>`
    select b.id, b.label, b.customer_name, b.status, b.opened_at, b.closed_at, b.order_id, o.code, po.full_name as opened_name, pc.full_name as closed_name, b.cancel_reason
    from table_bills b join profiles po on po.id = b.opened_by left join profiles pc on pc.id = b.closed_by left join orders o on o.id = b.order_id
    where b.id = ${id} and b.store_id = ${store.id}`;
  if (!bill) notFound();
  const [items, payments, productRows] = await Promise.all([
    sql<{ id: string; name: string; unit_price_cents: number; quantity: number; notes: string | null; lines: string[]; added_at: Date; cancelled_at: Date | null; cancel_reason: string | null; by_name: string }[]>`
      select i.id, i.name, i.unit_price_cents, i.quantity, i.notes, i.lines, i.added_at, i.cancelled_at, i.cancel_reason, p.full_name as by_name
      from table_bill_items i join profiles p on p.id = i.added_by where i.bill_id = ${id} order by i.added_at`,
    sql<{ id: string; method: "pix" | "card" | "cash"; amount_cents: number; received_at: Date; cancelled_at: Date | null; cancel_reason: string | null; by_name: string }[]>`
      select pay.id, pay.method, pay.amount_cents, pay.received_at, pay.cancelled_at, pay.cancel_reason, p.full_name as by_name
      from table_bill_payments pay join profiles p on p.id = pay.received_by where pay.bill_id = ${id} order by pay.received_at`,
    bill.status === "aberta"
      ? sql<{ id: string; section: string | null }[]>`
          select p.id, s.name as section from products p left join product_sections s on s.id = p.section_id
          where p.store_id = ${store.id} and p.deleted_at is null and p.available and p.weight_step_grams is null order by s.sort_order nulls last, p.sort_order, p.name`
      : Promise.resolve([]),
  ]);
  const details = await loadProducts(productRows.map((row) => row.id));
  const products: BillProduct[] = productRows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    const status = productStatus(detail.rules, at);
    return [{ id: detail.id, name: detail.name, section: row.section ?? "Outros", priceCents: detail.priceCents, groups: detail.groups, soldOut: !status.orderable && status.reason === "sold_out" }];
  });
  const totals = billTotals(
    items.map((item) => ({ unitPriceCents: item.unit_price_cents, quantity: item.quantity, cancelled: item.cancelled_at !== null })),
    payments.map((payment) => ({ method: payment.method, amountCents: payment.amount_cents, cancelled: payment.cancelled_at !== null })),
  );
  const open = bill.status === "aberta";
  const canCancel = hasPermission(membership, "vendas.descontos");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/lojista/mesas" className="inline-flex min-h-11 items-center self-start font-semibold text-brand-dark">← Mesas e balcão</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">{bill.label}</h1>
          <p className="text-sm text-coffee-soft">
            Aberta por {bill.opened_name} em {formatDateTime(bill.opened_at)}{bill.customer_name && ` · ${bill.customer_name}`}
            {bill.status === "fechada" && <> · fechada por {bill.closed_name} em {formatDateTime(bill.closed_at!)}{bill.code && <> · pedido <Link href={`/lojista/pedidos/${bill.order_id}`} className="underline">{bill.code}</Link></>}</>}
            {bill.status === "cancelada" && <> · cancelada: {bill.cancel_reason}</>}
          </p>
        </div>
        <dl className="text-right" data-testid="bill-totals">
          <div><dt className="inline text-sm text-coffee-soft">Total </dt><dd className="inline font-display text-3xl font-semibold" data-testid="bill-total">{formatCents(totals.totalCents)}</dd></div>
          <div className="text-sm"><dt className="inline">Pago </dt><dd className="inline font-semibold">{formatCents(totals.paidCents)}</dd>
            {totals.remainingCents > 0 && <> · <dt className="inline">falta </dt><dd className="inline font-bold text-danger" data-testid="bill-remaining">{formatCents(totals.remainingCents)}</dd></>}
            {totals.changeCents > 0 && <> · <dt className="inline">troco </dt><dd className="inline font-bold">{formatCents(totals.changeCents)}</dd></>}
          </div>
        </dl>
      </header>

      {open && (
        <section className={card}>
          <h2 className="text-xl">Adicionar item</h2>
          {products.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum produto disponível no cardápio.</p> : <BillItemForm billId={bill.id} products={products} />}
        </section>
      )}

      <section className={card}>
        <h2 className="text-xl">Itens</h2>
        {items.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum item ainda.</p> : (
          <ul className="divide-y divide-cream text-sm" data-testid="bill-items">
            {items.map((item) => (
              <li key={item.id} className={`flex flex-wrap items-start justify-between gap-2 py-2 ${item.cancelled_at ? "text-coffee-soft line-through" : ""}`}>
                <span className="min-w-0">
                  <strong>{item.quantity}× {item.name}</strong> · {formatCents(item.unit_price_cents * item.quantity)}
                  {item.lines.map((line) => <span key={line} className="block pl-3 text-xs">{line}</span>)}
                  {item.notes && <span className="block pl-3 text-xs">Obs: {item.notes}</span>}
                  <span className="block text-xs no-underline">{item.by_name} · {formatDateTime(item.added_at).slice(-5)}{item.cancelled_at && ` · cancelado: ${item.cancel_reason}`}</span>
                </span>
                {open && !item.cancelled_at && canCancel && (
                  <ActionForm action={cancelItem} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="itemId" value={item.id} />
                    <input name="reason" required minLength={3} placeholder="Motivo" aria-label={`Motivo para cancelar ${item.name}`} className="min-h-11 w-32 rounded-xl px-2 text-sm ring-1 ring-peach" />
                    <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">Cancelar item</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-xl">Pagamentos</h2>
        {payments.length > 0 && (
          <ul className="divide-y divide-cream text-sm" data-testid="bill-payments">
            {payments.map((payment) => (
              <li key={payment.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${payment.cancelled_at ? "text-coffee-soft line-through" : ""}`}>
                <span>{PAYMENT[payment.method]} · <strong>{formatCents(payment.amount_cents)}</strong> · {payment.by_name} · {formatDateTime(payment.received_at).slice(-5)}{payment.cancelled_at && ` · cancelado: ${payment.cancel_reason}`}</span>
                {open && !payment.cancelled_at && canCancel && (
                  <ActionForm action={cancelPayment} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="paymentId" value={payment.id} />
                    <input name="reason" required minLength={3} placeholder="Motivo" aria-label="Motivo para cancelar o pagamento" className="min-h-11 w-32 rounded-xl px-2 text-sm ring-1 ring-peach" />
                    <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">Cancelar</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {open && totals.remainingCents > 0 && (
          <ActionForm action={addPayment} resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="billId" value={bill.id} />
            <label className="flex flex-col gap-1 text-xs font-semibold">Forma
              <select name="method" defaultValue="cash" className={inputClass}><option value="cash">Dinheiro</option><option value="pix">Pix</option><option value="card">Cartão</option></select>
            </label>
            <Field label="Valor recebido (R$)" name="amount" inputMode="decimal" required defaultValue={(totals.remainingCents / 100).toFixed(2).replace(".", ",")} />
            <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Registrar pagamento</SubmitButton>
          </ActionForm>
        )}
        {open && (
          <ActionForm action={closeTableBill} className="flex flex-col gap-2">
            <input type="hidden" name="billId" value={bill.id} />
            <SubmitButton className="self-start">Fechar conta e liberar {bill.label.startsWith("Mesa") ? "a mesa" : "o balcão"}</SubmitButton>
            {totals.remainingCents > 0 && totals.totalCents > 0 && <p className="text-xs text-coffee-soft">Para fechar, registre os pagamentos até zerar o que falta.</p>}
          </ActionForm>
        )}
      </section>

      {open && canCancel && totals.totalCents === 0 && totals.paidCents === 0 && (
        <details className="rounded-card bg-white p-4 ring-1 ring-peach">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">Cancelar conta aberta por engano</summary>
          <ActionForm action={cancelTableBill} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="billId" value={bill.id} />
            <Field label="Motivo" name="reason" required minLength={3} maxLength={200} />
            <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Cancelar conta</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
