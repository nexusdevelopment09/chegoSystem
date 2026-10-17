import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClosingRow, CLOSING_STATUS_LABELS } from "@/components/fees/FeeViews";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { Stat } from "@/components/ui/Stats";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { listClosings, type ClosingStatus } from "@/lib/fees/closing";
import { getFeePixProvider } from "@/lib/fees/pix";
import { formatCents, formatDateTime } from "@/lib/format";
import { addFeeAdjustment } from "./actions";

export const metadata: Metadata = { title: "Taxas das lojas" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const STATUSES = Object.keys(CLOSING_STATUS_LABELS) as ClosingStatus[];

type SearchParams = Promise<Record<string, string | undefined>>;

export default function AdminFeesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <AdminFees searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminFees({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const params = await searchParams;
  const status = STATUSES.includes(params.situacao as ClosingStatus) ? (params.situacao as ClosingStatus) : undefined;

  const [[totals], closings, unapplied, stores, disputes] = await Promise.all([
    sql<{ generated: number; orders: number; received: number; due: number; open: number; debtors: number; overdue: number; review: number }[]>`
      select
        (select coalesce(sum(amount_cents), 0) from fee_entries where kind in ('order_fee', 'order_fee_reversal'))::int as generated,
        (select coalesce(sum(case when kind = 'order_fee' then 1 when kind = 'order_fee_reversal' then -1 else 0 end), 0) from fee_entries)::int as orders,
        (select coalesce(sum(amount_cents), 0) from fee_payments where applied)::int as received,
        (select coalesce(sum(total_due_cents), 0) from store_closings where status in ('awaiting_payment', 'overdue', 'in_review'))::int as due,
        (select coalesce(sum(amount_cents), 0) from fee_entries where closing_id is null)::int as open,
        (select count(distinct store_id) from store_closings where status in ('awaiting_payment', 'overdue', 'in_review'))::int as debtors,
        (select count(*) from store_closings where status = 'overdue')::int as overdue,
        (select count(*) from store_closings where status = 'in_review')::int as review`,
    listClosings({ status, limit: 80 }),
    sql<{ id: string; amount_cents: number; received_at: Date; provider_transaction_id: string; store_name: string; closing_id: string }[]>`
      select p.id, p.amount_cents, p.received_at, p.provider_transaction_id, s.name as store_name, c.closing_id
      from fee_payments p join fee_charges c on c.id = p.charge_id join stores s on s.id = c.store_id
      where not p.applied order by p.received_at desc limit 30`,
    sql<{ id: string; name: string }[]>`select id, name from stores where status in ('active', 'paused', 'pending') order by name`,
    sql<{ id: string; code: string; order_id: string; store_name: string; courier_name: string; amount_cents: number; store_marked_paid_at: Date | null }[]>`
      select e.id, o.code, o.id as order_id, s.name as store_name, p.full_name as courier_name, e.amount_cents, e.store_marked_paid_at
      from courier_earnings e join orders o on o.id = e.order_id join stores s on s.id = e.store_id join profiles p on p.id = e.courier_id
      where e.payer = 'store' and e.status = 'disputed' order by e.created_at desc limit 30`,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Taxas das lojas</h1>
        <p className="text-coffee-soft">
          Taxa por pedido concluído, paga pela loja por Pix depois do fechamento do expediente. Gerado, a receber e recebido
          aparecem separados: um Pix emitido só conta como recebido depois da confirmação do provedor.
        </p>
        {!getFeePixProvider() && (
          <p role="status" className="mt-2 rounded-2xl bg-peach px-4 py-3 text-sm font-semibold">
            Nenhum provedor Pix configurado: as lojas veem “cobrança indisponível” e os valores ficam pendentes.
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Taxas geradas" value={formatCents(totals.generated)} hint={`${totals.orders} pedidos`} />
        <Stat label="Recebido" value={formatCents(totals.received)} />
        <Stat label="A receber (fechado)" value={formatCents(totals.due)} hint={`${totals.debtors} loja(s) com saldo`} href="/admin/taxas?situacao=awaiting_payment" />
        <Stat label="Em aberto (não fechado)" value={formatCents(totals.open)} />
        <Stat label="Vencidos" value={totals.overdue} href="/admin/taxas?situacao=overdue" />
        <Stat label="Em análise" value={totals.review} href="/admin/taxas?situacao=in_review" />
      </div>

      {unapplied.length > 0 && (
        <section className={card} aria-labelledby="unapplied">
          <h2 id="unapplied" className="text-xl">Pagamentos não aplicados</h2>
          <p className="-mt-2 text-sm text-coffee-soft">Valor diferente do cobrado ou pagamento a mais. Confira e devolva ou ajuste por fora.</p>
          <ul className="divide-y divide-cream text-sm">
            {unapplied.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/taxas/${payment.closing_id}`} className="font-semibold text-brand-dark underline">{payment.store_name}</Link>
                <span>{formatCents(payment.amount_cents)} · {formatDateTime(payment.received_at)} · transação {payment.provider_transaction_id}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {disputes.length > 0 && (
        <section className={card} aria-labelledby="disputes">
          <h2 id="disputes" className="text-xl">Entregas contestadas</h2>
          <p className="-mt-2 text-sm text-coffee-soft">A loja marcou como pago, mas o entregador diz que não recebeu. Converse com os dois.</p>
          <ul className="divide-y divide-cream text-sm">
            {disputes.map((row) => (
              <li key={row.id} data-testid="courier-dispute" className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/pedidos/${row.order_id}`} className="font-semibold text-brand-dark underline">{row.code}</Link>
                <span>{row.store_name} → {row.courier_name} · {formatCents(row.amount_cents)}{row.store_marked_paid_at && ` · loja marcou em ${formatDateTime(row.store_marked_paid_at)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card} aria-labelledby="closings">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="closings" className="text-xl">Fechamentos</h2>
          <nav aria-label="Filtrar fechamentos" className="flex flex-wrap gap-2 text-sm">
            <Link href="/admin/taxas" aria-current={!status ? "true" : undefined} className={`rounded-full px-3 py-2 font-bold ring-1 ${!status ? "bg-brand-dark text-white ring-brand-dark" : "ring-peach"}`}>Todos</Link>
            {STATUSES.map((value) => (
              <Link key={value} href={`/admin/taxas?situacao=${value}`} aria-current={status === value ? "true" : undefined}
                className={`rounded-full px-3 py-2 font-bold ring-1 ${status === value ? "bg-brand-dark text-white ring-brand-dark" : "ring-peach"}`}>
                {CLOSING_STATUS_LABELS[value]}
              </Link>
            ))}
          </nav>
        </div>
        {closings.length === 0 ? (
          <p className="text-coffee-soft">Nenhum fechamento aqui.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {closings.map((closing) => <ClosingRow key={closing.id} closing={closing} storeName={closing.store_name} href={`/admin/taxas/${closing.id}`} />)}
          </ul>
        )}
      </section>

      <ActionForm action={addFeeAdjustment} resetOnSuccess className={card}>
        <h2 className="text-xl">Lançar ajuste</h2>
        <p className="-mt-2 text-sm text-coffee-soft">Entra no próximo fechamento da loja. Fica no log de auditoria, com o motivo.</p>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Loja
          <select name="storeId" required defaultValue="" className={inputClass}>
            <option value="" disabled>Escolha</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Tipo
            <select name="direction" defaultValue="credit" className={inputClass}>
              <option value="credit">Crédito para a loja (abate)</option>
              <option value="debit">Débito da loja (soma)</option>
            </select>
          </label>
          <Field label="Valor (R$)" name="amount" inputMode="decimal" required placeholder="2,50" />
        </div>
        <Field label="Motivo" name="reason" required maxLength={300} />
        <SubmitButton className="self-start">Lançar ajuste</SubmitButton>
      </ActionForm>
    </div>
  );
}
