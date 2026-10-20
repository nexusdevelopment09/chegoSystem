"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { isLocalEnv } from "@/lib/env";
import { handleFeeWebhook, requestFeeCharge } from "@/lib/fees/charges";
import { closeBusinessDay, currentBusinessDate } from "@/lib/fees/closing";
import { buildMockFeeWebhook } from "@/lib/fees/pix";
import { notify } from "@/lib/notifications/notify";
import { formatCents } from "@/lib/format";

// Taxas do Chegô no painel da loja. Só o dono da loja mexe aqui. A loja fecha o
// expediente e gera o Pix; nunca muda valores nem dá baixa num pagamento.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const owner = () => requirePermission("financeiro.ver");
const uuid = z.uuid();

/** Fecha o expediente de hoje, depois de a loja conferir o resumo. */
export async function closeToday(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  if (formData.get("confirm") !== "on") return { error: "Confira o resumo e marque a caixa para fechar." };

  const at = await now();
  const result = await closeBusinessDay({ storeId: membership.storeId, businessDate: await currentBusinessDate(at), at, closedBy: profile.id });
  if (!result.closing) return { error: result.reason };
  if (result.created) {
    await audit({ actorId: profile.id, action: "fees.close_day", entityType: "store_closing", entityId: result.closing.id, storeId: membership.storeId, details: { total_due_cents: result.closing.total_due_cents } });
  }
  revalidatePath("/lojista/taxas");
  redirect(`/lojista/taxas/${result.closing.id}`);
}

/** Gera (ou reaproveita) o Pix de um fechamento. O valor vem do fechamento no servidor. */
export async function payClosing(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { membership } = await owner();
  const closingId = uuid.safeParse(formData.get("closingId"));
  if (!closingId.success) return { error: "Fechamento inválido." };

  const result = await requestFeeCharge({ closingId: closingId.data, storeId: membership.storeId, at: await now() });
  if (!result.ok) return { error: result.error };
  revalidatePath(`/lojista/taxas/${closingId.data}`);
  return { ok: true, message: result.reused ? "Este é o Pix que já estava aberto." : "Pix gerado." };
}

/**
 * Só no ambiente de testes: faz o papel do banco e avisa que o Pix foi pago, pelo
 * mesmo webhook assinado que um provedor de verdade usaria.
 */
export async function simulateFeePayment(formData: FormData): Promise<void> {
  if (!isLocalEnv) throw new Error("Not available outside the test environment.");
  const { membership } = await owner();
  const chargeId = uuid.parse(formData.get("chargeId"));
  const [charge] = await sql<{ provider_charge_id: string; amount_cents: number; closing_id: string }[]>`
    select provider_charge_id, amount_cents, closing_id from fee_charges
    where id = ${chargeId} and store_id = ${membership.storeId} and status = 'pending'`;
  if (charge) {
    const { rawBody, signature } = buildMockFeeWebhook({ type: "charge.paid", providerChargeId: charge.provider_charge_id, amountCents: charge.amount_cents });
    await handleFeeWebhook(rawBody, signature, await now());
    revalidatePath(`/lojista/taxas/${charge.closing_id}`);
  }
}

/**
 * A loja pagou por fora (Pix, dinheiro) o entregador da rede que fez uma entrega dela.
 * Fica "a loja disse que pagou" até o entregador confirmar que recebeu.
 */
export async function markCourierPaid(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await owner();
  const id = uuid.safeParse(formData.get("earningId"));
  if (!id.success) return { error: "Entrega inválida." };
  const at = await now();
  const [row] = await sql<{ courier_id: string; amount_cents: number; code: string }[]>`
    update courier_earnings e set status = 'paid_by_store', store_marked_paid_at = ${at}
    from orders o
    where e.id = ${id.data} and e.store_id = ${membership.storeId} and e.payer = 'store' and e.status in ('pending', 'disputed') and o.id = e.order_id
    returning e.courier_id, e.amount_cents, o.code`;
  if (!row) return { error: "Esta entrega já foi marcada como paga." };
  await audit({ actorId: profile.id, action: "courier.store_paid", entityType: "courier_earning", entityId: id.data, storeId: membership.storeId, details: { amount_cents: row.amount_cents } });
  await notify({
    profileIds: [row.courier_id], type: "courier_store_paid", title: "A loja diz que pagou sua entrega",
    body: `Pedido ${row.code}: ${formatCents(row.amount_cents)}. Confirme no app quando receber.`, link: "/entregador", channels: ["push"], at,
  });
  revalidatePath("/lojista/taxas");
  return { ok: true, message: "Registrado. O entregador vai confirmar que recebeu." };
}
