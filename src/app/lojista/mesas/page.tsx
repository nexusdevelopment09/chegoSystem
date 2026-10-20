import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { billTotals } from "@/lib/tables/rules";
import { openTableBill, saveTable, toggleTable } from "./actions";

export const metadata: Metadata = { title: "Mesas e balcão" };

type OpenBill = { id: string; table_id: string | null; label: string; customer_name: string | null; opened_at: Date; total: number; paid: number; items: number };

export default function TablesPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando mesas" />}>
      <Tables />
    </Suspense>
  );
}

async function Tables() {
  const { membership, store } = await getMerchantContext("vendas.presenciais");
  const [tables, bills, closed] = await Promise.all([
    sql<{ id: string; label: string; active: boolean }[]>`select id, label, active from store_tables where store_id = ${store.id} order by active desc, sort_order, label`,
    sql<OpenBill[]>`
      select b.id, b.table_id, b.label, b.customer_name, b.opened_at,
             coalesce((select sum(i.unit_price_cents * i.quantity) from table_bill_items i where i.bill_id = b.id and i.cancelled_at is null), 0)::int as total,
             coalesce((select sum(p.amount_cents) from table_bill_payments p where p.bill_id = b.id and p.cancelled_at is null), 0)::int as paid,
             (select count(*)::int from table_bill_items i where i.bill_id = b.id and i.cancelled_at is null) as items
      from table_bills b where b.store_id = ${store.id} and b.status = 'aberta' order by b.opened_at`,
    sql<{ id: string; label: string; closed_at: Date; code: string | null; order_id: string | null }[]>`
      select b.id, b.label, b.closed_at, o.code, b.order_id from table_bills b left join orders o on o.id = b.order_id
      where b.store_id = ${store.id} and b.status = 'fechada' order by b.closed_at desc limit 10`,
  ]);
  const byTable = new Map(bills.filter((bill) => bill.table_id).map((bill) => [bill.table_id!, bill]));
  const counter = bills.filter((bill) => !bill.table_id);
  const state = (bill: OpenBill | undefined) => {
    if (!bill) return { text: "Livre", tone: "bg-white ring-peach" };
    const totals = billTotals([{ unitPriceCents: bill.total, quantity: 1, cancelled: false }], [{ method: "cash", amountCents: bill.paid, cancelled: false }]);
    if (bill.items > 0 && totals.remainingCents === 0) return { text: "Aguardando fechamento", tone: "bg-success/10 ring-success" };
    return { text: "Ocupada", tone: "bg-peach ring-brand-dark" };
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl">Mesas e balcão</h1>
          <p className="text-coffee-soft">Vendas feitas na loja, com os mesmos produtos, preços e estoque do cardápio. Ao fechar, a conta entra nos relatórios.</p>
        </div>
        <form action={openTableBill}><Button type="submit" className="min-h-11 px-4 text-sm">Nova venda no balcão</Button></form>
      </header>

      {tables.filter((table) => table.active).length === 0 ? (
        <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">
          Nenhuma mesa cadastrada.{hasPermission(membership, "mesas.gerenciar") ? " Cadastre abaixo." : " Peça ao dono para cadastrar."} O balcão funciona sem mesa.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="tables">
          {tables.filter((table) => table.active).map((table) => {
            const bill = byTable.get(table.id);
            const status = state(bill);
            return (
              <li key={table.id} className={`flex flex-col gap-2 rounded-card p-3 ring-2 ${status.tone}`} data-testid="table" aria-label={`Mesa ${table.label}: ${status.text}`}>
                <p className="font-display text-2xl font-semibold">Mesa {table.label}</p>
                <p className="text-sm font-semibold">{status.text}</p>
                {bill ? (
                  <>
                    <p className="text-sm">{formatCents(bill.total)}{bill.paid > 0 && ` · pago ${formatCents(bill.paid)}`}</p>
                    <p className="text-xs text-coffee-soft">desde {formatDateTime(bill.opened_at).slice(-5)}{bill.customer_name && ` · ${bill.customer_name}`}</p>
                    <Link href={`/lojista/mesas/conta/${bill.id}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-dark px-3 text-sm font-bold text-white">Abrir conta</Link>
                  </>
                ) : (
                  <form action={openTableBill}>
                    <input type="hidden" name="tableId" value={table.id} />
                    <Button type="submit" variant="secondary" className="min-h-11 w-full px-3 text-sm">Abrir conta</Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {counter.length > 0 && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Vendas de balcão abertas</h2>
          <ul className="divide-y divide-cream text-sm">
            {counter.map((bill) => (
              <li key={bill.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{bill.label}{bill.customer_name && ` · ${bill.customer_name}`} · {formatCents(bill.total)} · desde {formatDateTime(bill.opened_at)}</span>
                <Link href={`/lojista/mesas/conta/${bill.id}`} className="inline-flex min-h-11 items-center font-bold text-brand-dark underline">Abrir</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closed.length > 0 && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Fechadas por último</h2>
          <ul className="divide-y divide-cream text-sm">
            {closed.map((bill) => (
              <li key={bill.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/lojista/mesas/conta/${bill.id}`} className="underline">{bill.label}</Link>
                <span className="text-coffee-soft">{formatDateTime(bill.closed_at)}{bill.code && <> · pedido <Link href={`/lojista/pedidos/${bill.order_id}`} className="underline">{bill.code}</Link></>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasPermission(membership, "mesas.gerenciar") && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Cadastro de mesas</h2>
          <ActionForm action={saveTable} resetOnSuccess className="flex flex-wrap items-end gap-2">
            <Field label="Número ou nome da mesa" name="label" required maxLength={30} placeholder="Ex.: 1, Varanda 2" />
            <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Cadastrar mesa</SubmitButton>
          </ActionForm>
          {tables.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {tables.map((table) => (
                <li key={table.id} className="flex items-center gap-2 rounded-full bg-cream py-1 pl-3 pr-1 text-sm">
                  Mesa {table.label}
                  <form action={toggleTable}><input type="hidden" name="id" value={table.id} /><Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">{table.active ? "Desativar" : "Ativar"}</Button></form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
