import type { Metadata } from "next";
import { Suspense } from "react";
import { ClosingRow, FeeEntries, formatDay } from "@/components/fees/FeeViews";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Stat } from "@/components/ui/Stats";
import { closingEntries, feeSummary, listClosings } from "@/lib/fees/closing";
import { closingTotals } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { getSettings } from "@/lib/settings";
import { sql } from "@/lib/db";
import { EARNING_LABELS, type EarningStatus } from "@/lib/labels";
import { closeToday, markCourierPaid } from "./actions";

export const metadata: Metadata = { title: "Taxas do Chegô" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";

export default function FeesPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Fees />
    </Suspense>
  );
}

async function Fees() {
  const { store, at } = await getMerchantContext("financeiro.ver");
  const [summary, open, closings, settings, couriers] = await Promise.all([
    feeSummary(store.id, at),
    closingEntries({ storeId: store.id, open: true }),
    listClosings({ storeId: store.id, limit: 30 }),
    getSettings(),
    sql<{ id: string; code: string; courier_name: string; amount_cents: number; status: EarningStatus; created_at: Date }[]>`
      select e.id, o.code, p.full_name as courier_name, e.amount_cents, e.status, e.created_at
      from courier_earnings e join orders o on o.id = e.order_id join profiles p on p.id = e.courier_id
      where e.store_id = ${store.id} and e.payer = 'store' and e.status <> 'confirmed'
      order by e.created_at desc limit 50`,
  ]);
  const openTotals = closingTotals(open.map((entry) => ({ kind: entry.kind, amountCents: entry.amount_cents })));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-3xl">Taxas do Chegô</h1>
        <p className="text-coffee-soft">
          O cliente paga direto para a loja. O Chegô cobra {formatCents(settings.order_fee_cents)} por pedido concluído
          (entregue ou retirado), somados por expediente e pagos depois, por Pix.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Pedidos hoje (${formatDay(summary.today)})`} value={summary.todayOrders} />
        <Stat label="Taxas de hoje" value={formatCents(summary.todayFeesCents)} />
        <Stat label="A pagar (fechados)" value={formatCents(summary.dueCents)} hint={summary.nextDueDate ? `Vence ${formatDay(summary.nextDueDate)}` : undefined} />
        <Stat label="Em aberto (não fechado)" value={formatCents(summary.openCents)} />
      </div>
      <p className="text-sm text-coffee-soft" data-testid="fee-last">
        Último fechamento: {summary.lastClosing ? `${formatDay(summary.lastClosing.business_date)} (${formatCents(summary.lastClosing.total_due_cents)})` : "nenhum ainda"}
        {" · "}Último pagamento: {summary.lastPayment ? `${formatCents(summary.lastPayment.amount_cents)} em ${formatDateTime(summary.lastPayment.received_at)}` : "nenhum ainda"}
      </p>

      <section className={card} aria-labelledby="close-day">
        <h2 id="close-day" className="text-xl">Fechar expediente</h2>
        {open.length === 0 ? (
          <p className="text-coffee-soft">Nada em aberto. Os pedidos concluídos aparecem aqui até o fechamento.</p>
        ) : (
          <>
            <p className="text-sm text-coffee-soft">
              Confira antes de fechar. Expedientes que ficarem abertos são fechados sozinhos no dia seguinte, depois das{" "}
              {settings.business_day_cutoff_hour}h.
            </p>
            <dl className="text-base" data-testid="open-summary">
              <div className="flex justify-between py-1"><dt>Pedidos concluídos</dt><dd>{openTotals.orderCount}</dd></div>
              <div className="flex justify-between py-1"><dt>Taxas</dt><dd>{formatCents(openTotals.feesCents)}</dd></div>
              {openTotals.creditsCents !== 0 && <div className="flex justify-between py-1 text-success"><dt>Créditos de cupons do Chegô</dt><dd>{formatCents(openTotals.creditsCents)}</dd></div>}
              {openTotals.adjustmentsCents !== 0 && <div className="flex justify-between py-1"><dt>Ajustes e saldos</dt><dd>{formatCents(openTotals.adjustmentsCents)}</dd></div>}
              <div className="flex justify-between border-t border-peach pt-2 text-xl font-bold"><dt>Total</dt><dd>{formatCents(Math.max(openTotals.netCents, 0))}</dd></div>
            </dl>
            {openTotals.netCents < 0 && (
              <p className="text-sm text-success">O crédito de {formatCents(-openTotals.netCents)} passa para o próximo fechamento.</p>
            )}
            <details>
              <summary className="min-h-11 cursor-pointer font-semibold text-brand-dark">Ver os {open.length} lançamentos</summary>
              <FeeEntries entries={open} orderHref={(orderId) => `/lojista/pedidos/${orderId}`} />
            </details>
            <ActionForm action={closeToday} className="flex flex-col gap-3">
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="confirm" className="size-5 shrink-0 accent-brand-dark" />
                Conferi os valores acima
              </label>
              <SubmitButton className="self-start">Fechar expediente</SubmitButton>
            </ActionForm>
          </>
        )}
      </section>

      {couriers.length > 0 && (
        <section className={card} aria-labelledby="couriers-to-pay">
          <h2 id="couriers-to-pay" className="text-xl">Entregadores do Chegô a pagar</h2>
          <p className="-mt-2 text-sm text-coffee-soft">
            Nas entregas pela rede do Chegô, a loja paga o entregador direto (Pix ou dinheiro), no valor mostrado na oferta.
            Marque aqui quando pagar; o entregador confirma que recebeu.
          </p>
          <ul className="divide-y divide-cream text-sm">
            {couriers.map((row) => (
              <li key={row.id} data-testid="courier-to-pay" className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <strong>{row.code}</strong> · {row.courier_name} · {formatCents(row.amount_cents)}
                  <span className={`block text-xs font-bold ${row.status === "disputed" ? "text-danger" : "text-coffee-soft"}`}>{EARNING_LABELS[row.status]}</span>
                </span>
                {(row.status === "pending" || row.status === "disputed") && (
                  <ActionForm action={markCourierPaid}>
                    <input type="hidden" name="earningId" value={row.id} />
                    <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Paguei o entregador</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card} aria-labelledby="history">
        <h2 id="history" className="text-xl">Fechamentos</h2>
        {closings.length === 0 ? (
          <p className="text-coffee-soft">Nenhum fechamento ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {closings.map((closing) => <ClosingRow key={closing.id} closing={closing} href={`/lojista/taxas/${closing.id}`} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
