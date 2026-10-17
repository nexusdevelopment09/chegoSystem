import "server-only";
import { sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getFeePixProvider } from "./pix";

export type FeeCharge = {
  id: string; closing_id: string; provider: string; provider_charge_id: string; amount_cents: number;
  status: "pending" | "paid" | "expired" | "cancelled" | "in_review"; pix_copy_paste: string | null;
  expires_at: Date; created_at: Date; paid_at: Date | null;
};

export type ChargeResult =
  | { ok: true; charge: FeeCharge; reused: boolean; simulated: boolean }
  | { ok: false; error: string };

const CHARGE_COLUMNS = sql`id, closing_id, provider, provider_charge_id, amount_cents, status, pix_copy_paste, expires_at, created_at, paid_at`;

/**
 * Pix para pagar um fechamento. O valor é sempre o do fechamento no servidor; o
 * navegador não escolhe nada.
 *
 * - Recarregar a página ou clicar de novo reaproveita a cobrança pendente ainda válida.
 * - Cobrança vencida é marcada como expirada (fica no histórico) e outra é gerada, do
 *   mesmo valor: a dívida não dobra, porque ela está no fechamento, não na cobrança.
 */
export async function requestFeeCharge(input: { closingId: string; storeId: string; at: Date }): Promise<ChargeResult> {
  const provider = getFeePixProvider();
  if (!provider) {
    return { ok: false, error: "A cobrança por Pix ainda não está disponível. O valor continua registrado como pendente." };
  }
  const settings = await getSettings();

  return sql.begin(async (tx): Promise<ChargeResult> => {
    const [closing] = await tx<{ id: string; store_id: string; status: string; total_due_cents: number; business_date: string }[]>`
      select id, store_id, status, total_due_cents, business_date::text from store_closings
      where id = ${input.closingId} and store_id = ${input.storeId} for update`;
    if (!closing) return { ok: false, error: "Fechamento não encontrado." };
    if (closing.status === "paid") return { ok: false, error: "Este fechamento já está pago." };
    if (closing.status === "in_review") return { ok: false, error: "Este fechamento está em análise pela equipe do Chegô." };
    if (closing.total_due_cents <= 0) return { ok: false, error: "Não há valor a pagar neste fechamento." };

    const [pending] = await tx<FeeCharge[]>`
      select ${CHARGE_COLUMNS} from fee_charges where closing_id = ${closing.id} and status = 'pending' for update`;
    if (pending && pending.expires_at > input.at && pending.amount_cents === closing.total_due_cents) {
      return { ok: true, charge: pending, reused: true, simulated: provider.simulated };
    }
    if (pending) await tx`update fee_charges set status = 'expired' where id = ${pending.id}`;

    const [{ id }] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
    const expiresAt = new Date(input.at.getTime() + settings.fee_pix_expiration_hours * 60 * 60 * 1000);
    const created = await provider.createCharge({
      reference: id, amountCents: closing.total_due_cents, expiresAt,
      description: `Taxas do Chegô — expediente de ${closing.business_date}`,
    });
    const [charge] = await tx<FeeCharge[]>`
      insert into fee_charges (id, closing_id, store_id, provider, provider_charge_id, amount_cents, pix_copy_paste, expires_at, created_at)
      values (${id}, ${closing.id}, ${closing.store_id}, ${provider.name}, ${created.providerChargeId}, ${closing.total_due_cents},
              ${created.pixCopyPaste}, ${expiresAt}, ${input.at})
      returning ${CHARGE_COLUMNS}`;
    return { ok: true, charge, reused: false, simulated: provider.simulated };
  }) as Promise<ChargeResult>;
}

export type FeeWebhookOutcome = "processed" | "duplicate" | "invalid_signature" | "unknown_charge" | "in_review" | "unavailable";

/**
 * Aviso do provedor sobre uma cobrança das taxas. É o único jeito de um fechamento virar
 * "pago": o que o navegador ou a loja dizem nunca dá baixa.
 *
 * - Assinatura conferida primeiro.
 * - Cada evento e cada transação Pix são gravados uma vez: aviso repetido não paga duas vezes.
 * - Valor diferente do cobrado, ou pagamento de um fechamento já pago, não quita nada:
 *   o pagamento fica registrado e o fechamento vai para análise do admin.
 */
export async function handleFeeWebhook(rawBody: string, signature: string | null, at: Date): Promise<FeeWebhookOutcome> {
  const provider = getFeePixProvider();
  if (!provider) return "unavailable";
  const event = provider.parseWebhook(rawBody, signature);
  if (!event) return "invalid_signature";

  return sql.begin(async (tx): Promise<FeeWebhookOutcome> => {
    const inserted = await tx`
      insert into webhook_events (provider, event_id, payload)
      values (${`fees:${provider.name}`}, ${event.eventId}, ${tx.json(event.raw as never)})
      on conflict (provider, event_id) do nothing returning id`;
    if (inserted.length === 0) return "duplicate";

    const [charge] = await tx<FeeCharge[]>`
      select ${CHARGE_COLUMNS} from fee_charges where provider = ${provider.name} and provider_charge_id = ${event.providerChargeId} for update`;
    if (!charge) return "unknown_charge";
    const [closing] = await tx<{ id: string; status: string; total_due_cents: number }[]>`
      select id, status, total_due_cents from store_closings where id = ${charge.closing_id} for update`;

    let outcome: FeeWebhookOutcome = "processed";
    if (event.type === "charge.expired") {
      if (charge.status === "pending") await tx`update fee_charges set status = 'expired' where id = ${charge.id}`;
    } else {
      const amount = event.amountCents ?? 0;
      const matches = amount === charge.amount_cents && closing.status !== "paid";
      const saved = await tx`
        insert into fee_payments (charge_id, provider, provider_transaction_id, amount_cents, applied, received_at, raw_payload)
        values (${charge.id}, ${provider.name}, ${event.transactionId ?? event.eventId}, ${Math.max(amount, 1)}, ${matches}, ${at}, ${tx.json(event.raw as never)})
        on conflict (provider, provider_transaction_id) do nothing returning id`;
      if (saved.length === 0) {
        outcome = "duplicate";
      } else if (matches) {
        await tx`update fee_charges set status = 'paid', paid_at = ${at} where id = ${charge.id}`;
        await tx`update store_closings set status = 'paid', paid_at = ${at}, review_reason = null where id = ${closing.id}`;
      } else if (closing.status === "paid") {
        // Pagamento a mais de um fechamento já quitado: fica registrado (não aplicado) para o
        // admin conferir e devolver por fora; o fechamento continua pago.
        outcome = "in_review";
      } else {
        await tx`update fee_charges set status = 'in_review' where id = ${charge.id}`;
        await tx`
          update store_closings set status = 'in_review',
            review_reason = ${`Valor pago (${amount} centavos) diferente do cobrado (${charge.amount_cents} centavos).`}
          where id = ${closing.id}`;
        outcome = "in_review";
      }
    }
    await tx`update webhook_events set processed_at = ${at} where id = ${inserted[0].id}`;
    return outcome;
  }) as Promise<FeeWebhookOutcome>;
}

export async function listCharges(closingId: string): Promise<FeeCharge[]> {
  return sql<FeeCharge[]>`select ${CHARGE_COLUMNS} from fee_charges where closing_id = ${closingId} order by created_at desc`;
}
