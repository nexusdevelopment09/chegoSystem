"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { currentBusinessDate } from "@/lib/fees/closing";
import { parseMoney } from "@/lib/format";

// Ações do admin nas taxas do Chegô. Todas exigem motivo e ficam no log de auditoria.
// Nenhuma marca um fechamento como pago: só um pagamento confirmado pelo provedor faz isso.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const reasonText = z.string().trim().min(5, "Escreva o motivo (pelo menos 5 letras).").max(300);

/**
 * Ajuste na conta de uma loja (crédito ou débito), com motivo. Vira um lançamento novo,
 * em aberto, que entra no próximo fechamento. Nada do histórico é alterado.
 */
export async function addFeeAdjustment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireRole("admin");
  const storeId = z.uuid().safeParse(formData.get("storeId"));
  if (!storeId.success) return { error: "Escolha a loja." };
  const reason = reasonText.safeParse(formData.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0].message };
  const cents = parseMoney(String(formData.get("amount") ?? ""));
  if (cents === null || cents === 0) return { error: "Valor inválido. Use o formato 2,50." };
  const signed = formData.get("direction") === "credit" ? -cents : cents;

  const at = await now();
  const day = await currentBusinessDate(at);
  await sql.begin(async (tx) => {
    const [entry] = await tx<{ id: string }[]>`
      insert into fee_entries (store_id, kind, amount_cents, business_date, reason, created_by, created_at)
      values (${storeId.data}, 'adjustment', ${signed}, ${day}, ${reason.data}, ${profile.id}, ${at})
      returning id`;
    await audit({ actorId: profile.id, action: "fees.adjustment", entityType: "fee_entry", entityId: entry.id, storeId: storeId.data, details: { amount_cents: signed, reason: reason.data } }, tx);
  });
  revalidatePath("/admin/taxas");
  return { ok: true, message: "Ajuste lançado. Ele entra no próximo fechamento da loja." };
}

/**
 * Tira um fechamento de "em análise" depois de o admin conferir a divergência (por
 * exemplo, pagamento com valor errado já devolvido por fora). Ele volta a aguardar
 * pagamento; se algo deve ser abatido, o admin lança um ajuste.
 */
export async function resolveClosingReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireRole("admin");
  const closingId = z.uuid().safeParse(formData.get("closingId"));
  if (!closingId.success) return { error: "Fechamento inválido." };
  const reason = reasonText.safeParse(formData.get("reason"));
  if (!reason.success) return { error: reason.error.issues[0].message };

  const updated = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; store_id: string }[]>`
      update store_closings set status = 'awaiting_payment', review_reason = null
      where id = ${closingId.data} and status = 'in_review' returning id, store_id`;
    if (rows.length === 0) return null;
    await tx`update fee_charges set status = 'cancelled' where closing_id = ${closingId.data} and status = 'in_review'`;
    await audit({ actorId: profile.id, action: "fees.review_resolved", entityType: "store_closing", entityId: rows[0].id, storeId: rows[0].store_id, details: { reason: reason.data } }, tx);
    return rows[0];
  });
  if (!updated) return { error: "Este fechamento não está em análise." };
  revalidatePath("/admin/taxas");
  return { ok: true, message: "Fechamento voltou a aguardar pagamento." };
}
