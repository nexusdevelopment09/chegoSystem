import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ClosingStatusBadge, ClosingTotals, FeeEntries, formatDay } from "@/components/fees/FeeViews";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { listCharges } from "@/lib/fees/charges";
import { closingEntries, loadClosing } from "@/lib/fees/closing";
import { formatCents, formatDateTime } from "@/lib/format";
import { resolveClosingReview } from "../actions";

export const metadata: Metadata = { title: "Fechamento da loja" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";

type Params = Promise<{ id: string }>;

export default function AdminClosingPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <AdminClosing params={params} />
    </Suspense>
  );
}

async function AdminClosing({ params }: { params: Params }) {
  await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const closing = await loadClosing(id);
  if (!closing) notFound();

  const [entries, charges, payments, [store]] = await Promise.all([
    closingEntries({ closingId: closing.id }),
    listCharges(closing.id),
    sql<{ id: string; amount_cents: number; applied: boolean; received_at: Date; provider_transaction_id: string }[]>`
      select p.id, p.amount_cents, p.applied, p.received_at, p.provider_transaction_id
      from fee_payments p join fee_charges c on c.id = p.charge_id where c.closing_id = ${closing.id} order by p.received_at`,
    sql<{ name: string }[]>`select name from stores where id = ${closing.store_id}`,
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/taxas" className="font-semibold text-brand-dark underline">← Taxas das lojas</Link>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-3xl">{store.name}</h1>
          <p className="text-coffee-soft">Expediente de {formatDay(closing.business_date)} · fechado em {formatDateTime(closing.closed_at)} · vence {formatDay(closing.due_date)}</p>
        </div>
        <ClosingStatusBadge status={closing.status} />
      </header>

      <section className={card}><ClosingTotals closing={closing} /></section>

      {closing.status === "in_review" && (
        <ActionForm action={resolveClosingReview} className={card}>
          <h2 className="text-xl">Resolver a análise</h2>
          <p className="-mt-2 text-sm">{closing.review_reason}</p>
          <input type="hidden" name="closingId" value={closing.id} />
          <Field label="O que foi conferido e resolvido" name="reason" required maxLength={300} />
          <SubmitButton className="self-start">Voltar a aguardar pagamento</SubmitButton>
        </ActionForm>
      )}

      <section className={card}>
        <h2 className="text-xl">Cobranças e pagamentos</h2>
        {charges.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma cobrança gerada.</p> : (
          <ul className="divide-y divide-cream text-sm">
            {charges.map((charge) => (
              <li key={charge.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{charge.provider} · {formatDateTime(charge.created_at)} · {formatCents(charge.amount_cents)}</span>
                <span className="font-semibold">{charge.status}</span>
              </li>
            ))}
          </ul>
        )}
        {payments.map((payment) => (
          <p key={payment.id} className="text-sm">
            Pagamento {formatCents(payment.amount_cents)} em {formatDateTime(payment.received_at)} · transação {payment.provider_transaction_id} ·{" "}
            <strong>{payment.applied ? "aplicado" : "não aplicado (conferir)"}</strong>
          </p>
        ))}
      </section>

      <section className={card}>
        <h2 className="text-xl">Pedidos e lançamentos</h2>
        <FeeEntries entries={entries} orderHref={(orderId) => `/admin/pedidos/${orderId}`} />
      </section>
    </div>
  );
}
