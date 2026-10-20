import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { z } from "zod";
import { ClosingStatusBadge, ClosingTotals, FeeEntries, formatDay } from "@/components/fees/FeeViews";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { isLocalEnv } from "@/lib/env";
import { listCharges } from "@/lib/fees/charges";
import { closingEntries, loadClosing } from "@/lib/fees/closing";
import { getFeePixProvider } from "@/lib/fees/pix";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { payClosing, simulateFeePayment } from "../actions";

export const metadata: Metadata = { title: "Fechamento" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const CHARGE_LABELS = { pending: "Aguardando pagamento", paid: "Pago", expired: "Expirado", cancelled: "Cancelado", in_review: "Em análise" } as const;

type Params = Promise<{ id: string }>;

export default function ClosingPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <ClosingDetail params={params} />
    </Suspense>
  );
}

async function ClosingDetail({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { store, at } = await getMerchantContext("financeiro.ver");
  const closing = await loadClosing(id);
  // Uma loja nunca vê o fechamento de outra.
  if (!closing || closing.store_id !== store.id) notFound();

  const [entries, charges] = await Promise.all([closingEntries({ closingId: closing.id }), listCharges(closing.id)]);
  const pending = charges.find((charge) => charge.status === "pending" && charge.expires_at > at) ?? null;
  const provider = getFeePixProvider();
  const qrSvg = pending?.pix_copy_paste ? await QRCode.toString(pending.pix_copy_paste, { type: "svg", margin: 1, width: 220 }) : null;
  const payable = closing.total_due_cents > 0 && (closing.status === "awaiting_payment" || closing.status === "overdue");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/lojista/taxas" className="font-semibold text-brand-dark underline">← Taxas do Chegô</Link>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-3xl">Expediente de {formatDay(closing.business_date)}</h1>
          <p className="text-sm text-coffee-soft">Fechado em {formatDateTime(closing.closed_at)} · vence {formatDay(closing.due_date)}</p>
        </div>
        <ClosingStatusBadge status={closing.status} />
      </header>
      {closing.review_reason && (
        <p role="status" className="rounded-2xl bg-peach px-4 py-3 text-sm font-semibold">Em análise pela equipe do Chegô: {closing.review_reason}</p>
      )}

      <section className={card}>
        <ClosingTotals closing={closing} />
      </section>

      {payable && (
        <section className={card} aria-labelledby="pay">
          <h2 id="pay" className="text-xl">Pagar por Pix</h2>
          {!provider ? (
            <p role="status" data-testid="pix-unavailable" className="rounded-2xl bg-peach px-4 py-3 text-sm">
              A cobrança por Pix ainda não está disponível. O valor de {formatCents(closing.total_due_cents)} continua registrado
              como pendente; a equipe do Chegô avisa quando puder pagar.
            </p>
          ) : pending ? (
            <div className="flex flex-col items-center gap-3 text-center" data-testid="fee-pix">
              {provider.simulated && (
                <p className="rounded-2xl bg-peach px-4 py-2 text-sm font-bold">Ambiente de testes: este Pix não é válido e não cobra nada.</p>
              )}
              <p className="text-2xl font-bold">{formatCents(pending.amount_cents)}</p>
              <p className="text-sm text-coffee-soft">Para: Chegô · Expediente de {formatDay(closing.business_date)} · válido até {formatDateTime(pending.expires_at)}</p>
              {pending.pix_copy_paste && (
                <>
                  {/* O SVG é gerado no servidor a partir do código devolvido pelo provedor para esta cobrança. */}
                  <div className="rounded-2xl bg-white p-3 ring-1 ring-peach" role="img" aria-label="QR Code do Pix"
                    dangerouslySetInnerHTML={{ __html: qrSvg ?? "" }} />
                  <p className="w-full break-all rounded-2xl bg-cream px-3 py-2 font-mono text-xs" data-testid="fee-pix-code">{pending.pix_copy_paste}</p>
                  <CopyButton text={pending.pix_copy_paste} />
                </>
              )}
              <p className="text-sm text-coffee-soft">Abra o app do seu banco, escolha Pix e pague com o QR Code ou com o código. A baixa é automática.</p>
              {isLocalEnv && provider.simulated && (
                <form action={simulateFeePayment}>
                  <input type="hidden" name="chargeId" value={pending.id} />
                  <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">Simular pagamento do Pix</Button>
                </form>
              )}
            </div>
          ) : (
            <ActionForm action={payClosing} className="flex flex-col gap-2">
              <input type="hidden" name="closingId" value={closing.id} />
              <SubmitButton className="self-start">Gerar Pix de {formatCents(closing.total_due_cents)}</SubmitButton>
            </ActionForm>
          )}
        </section>
      )}

      {charges.length > 0 && (
        <section className={card}>
          <h2 className="text-xl">Cobranças</h2>
          <ul className="divide-y divide-cream text-sm">
            {charges.map((charge) => (
              <li key={charge.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{formatDateTime(charge.created_at)} · {formatCents(charge.amount_cents)}</span>
                <span className="font-semibold">{CHARGE_LABELS[charge.status]}{charge.paid_at && ` em ${formatDateTime(charge.paid_at)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="text-xl">Pedidos e lançamentos</h2>
        <FeeEntries entries={entries} orderHref={(orderId) => `/lojista/pedidos/${orderId}`} />
      </section>
    </div>
  );
}
