"use server";

import { revalidatePath } from "next/cache";
import type postgres from "postgres";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { recalculateRating } from "@/lib/stores/rating";

// Avaliações: a nota da loja é sempre a média das avaliações válidas (recalculateRating). Não existe
// ação para mudar a nota da loja diretamente. O super admin só oculta o que viola as regras,
// restaura o que foi ocultado por engano, analisa denúncias e corrige erro técnico comprovado de
// uma avaliação — sempre com motivo, valor anterior e novo, responsável e data (review_events).

export type ActionState = { error?: string; ok?: boolean; message?: string };

const reason = z.string().trim().min(3, "Escreva o motivo (pelo menos 3 letras).").max(500);
const done = () => revalidatePath("/admin", "layout");

type Review = { id: string; store_id: string; rating: number; hidden_at: Date | null; reported_at: Date | null; report_resolved_at: Date | null };

async function withReview(id: unknown, run: (review: Review, tx: postgres.TransactionSql, at: Date) => Promise<string | null>): Promise<string | null> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return "Avaliação inválida.";
  const at = await now();
  return sql.begin(async (tx) => {
    const [review] = await tx<Review[]>`select id, store_id, rating, hidden_at, reported_at, report_resolved_at from reviews where id = ${parsed.data} for update`;
    if (!review) return "Avaliação não encontrada.";
    const problem = await run(review, tx, at);
    if (!problem) await recalculateRating(tx, review.store_id, at);
    return problem;
  }) as Promise<string | null>;
}

export async function moderateReview(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const action = z.enum(["ocultar", "restaurar"]).safeParse(formData.get("action"));
  const why = reason.safeParse(formData.get("reason"));
  if (!action.success) return { error: "Ação inválida." };
  if (!why.success) return { error: why.error.issues[0].message };
  const hide = action.data === "ocultar";
  const problem = await withReview(formData.get("id"), async (review, tx, at) => {
    if (hide === !!review.hidden_at) return hide ? "Esta avaliação já está oculta." : "Esta avaliação já está visível.";
    await tx`
      update reviews set hidden_at = ${hide ? at : null}, hidden_by = ${hide ? profile.id : null}, hidden_reason = ${hide ? why.data : null},
        report_resolved_at = case when reported_at is not null and report_resolved_at is null then ${at}::timestamptz else report_resolved_at end,
        report_resolved_by = case when reported_at is not null and report_resolved_at is null then ${profile.id}::uuid else report_resolved_by end
      where id = ${review.id}`;
    await tx`insert into review_events (review_id, action, reason, actor_id, created_at) values (${review.id}, ${hide ? "ocultada" : "restaurada"}, ${why.data}, ${profile.id}, ${at})`;
    await audit({ actorId: profile.id, actorRole: "admin", module: "avaliacoes", action: hide ? "avaliacao.ocultada" : "avaliacao.restaurada", entityType: "review", entityId: review.id, storeId: review.store_id, reason: why.data }, tx);
    return null;
  });
  if (problem) return { error: problem };
  done();
  return { ok: true, message: hide ? "Avaliação ocultada. A nota da loja foi recalculada." : "Avaliação restaurada. A nota da loja foi recalculada." };
}

/** Denúncia analisada e mantida (a avaliação segue visível). Para ocultar, use "Ocultar". */
export async function dismissReport(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const why = reason.safeParse(formData.get("reason"));
  if (!why.success) return { error: why.error.issues[0].message };
  const problem = await withReview(formData.get("id"), async (review, tx, at) => {
    if (!review.reported_at || review.report_resolved_at) return "Não há denúncia em aberto nesta avaliação.";
    await tx`update reviews set report_resolved_at = ${at}, report_resolved_by = ${profile.id} where id = ${review.id}`;
    await tx`insert into review_events (review_id, action, reason, actor_id, created_at) values (${review.id}, 'denuncia_analisada', ${why.data}, ${profile.id}, ${at})`;
    await audit({ actorId: profile.id, actorRole: "admin", module: "avaliacoes", action: "avaliacao.denuncia_mantida", entityType: "review", entityId: review.id, storeId: review.store_id, reason: why.data }, tx);
    return null;
  });
  if (problem) return { error: problem };
  done();
  return { ok: true, message: "Denúncia analisada: a avaliação continua visível." };
}

/**
 * Correção de erro técnico comprovado numa avaliação (ex.: a nota gravada não é a que o cliente
 * escolheu por falha do app). Exige motivo e guarda o valor anterior e o novo.
 */
export async function correctRating(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const rating = z.coerce.number().int().min(1).max(5).safeParse(formData.get("rating"));
  const why = reason.safeParse(formData.get("reason"));
  if (!rating.success) return { error: "A nota vai de 1 a 5." };
  if (!why.success) return { error: why.error.issues[0].message };
  if (formData.get("confirm") !== "on") return { error: "Confirme que é a correção de um erro técnico comprovado." };
  const problem = await withReview(formData.get("id"), async (review, tx, at) => {
    if (review.rating === rating.data) return "A nota já é essa.";
    await tx`update reviews set rating = ${rating.data} where id = ${review.id}`;
    await tx`
      insert into review_events (review_id, action, old_rating, new_rating, reason, actor_id, created_at)
      values (${review.id}, 'nota_corrigida', ${review.rating}, ${rating.data}, ${why.data}, ${profile.id}, ${at})`;
    await audit({ actorId: profile.id, actorRole: "admin", module: "avaliacoes", action: "avaliacao.nota_corrigida", entityType: "review", entityId: review.id, storeId: review.store_id,
      reason: why.data, details: { antes: review.rating, depois: rating.data } }, tx);
    return null;
  });
  if (problem) return { error: problem };
  done();
  return { ok: true, message: "Nota corrigida e registrada no histórico. A média da loja foi recalculada." };
}
