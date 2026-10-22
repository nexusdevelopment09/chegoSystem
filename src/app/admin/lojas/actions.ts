"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccountError, closeStore, liftSuspension, setStoreActive, suspendStore } from "@/lib/admin/store-account";
import { requireSuperAdmin } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { fromLocal } from "@/lib/time";

// Situação da conta das lojas. Só o super admin; toda ação pede motivo e vai para o histórico
// da loja e para a auditoria (src/lib/admin/store-account.ts).

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const text = (value: FormDataEntryValue | null, max: number) => String(value ?? "").trim().slice(0, max);
const done = () => revalidatePath("/admin", "layout");
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** Campo datetime-local (horário de Maceió) → instante. */
const localDateTime = (value: string) => fromLocal(value.slice(0, 10), Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16)));

async function run(task: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await task();
    done();
    return { ok: true, message };
  } catch (error) {
    if (error instanceof AccountError) return { error: error.message };
    throw error;
  }
}

export async function toggleStoreActive(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Loja inválida." };
  const active = formData.get("active") === "1";
  const at = await now();
  return run(async () => {
    await sql.begin((tx) => setStoreActive(tx, { storeId: id.data, active, reason: text(formData.get("reason"), 300), actorId: profile.id, at }));
    return active ? "Loja ativada." : "Loja desativada.";
  });
}

export async function suspendStoreAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Loja inválida." };
  const at = await now();
  const startText = text(formData.get("startsAt"), 16);
  const endText = text(formData.get("endsAt"), 16);
  const indefinite = formData.get("indefinite") === "on";
  if (startText && !DATETIME.test(startText)) return { error: "Data de início inválida." };
  if (!indefinite && !DATETIME.test(endText)) return { error: "Informe até quando vai a suspensão, ou marque “por tempo indeterminado”." };
  const startsAt = startText ? localDateTime(startText) : at;
  return run(async () => {
    const { applied } = await sql.begin((tx) => suspendStore(tx, {
      storeId: id.data, reason: text(formData.get("reason"), 120), description: text(formData.get("description"), 2000) || null,
      startsAt: startsAt < at ? at : startsAt, endsAt: indefinite ? null : localDateTime(endText), notifyOwner: formData.get("notify") === "on", actorId: profile.id, at,
    }));
    return applied ? "Conta suspensa. A loja saiu do ar." : "Suspensão agendada para a data de início.";
  });
}

export async function liftSuspensionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Loja inválida." };
  const at = await now();
  return run(async () => {
    await sql.begin((tx) => liftSuspension(tx, { storeId: id.data, reason: text(formData.get("reason"), 300), actorId: profile.id, at }));
    return "Conta reativada.";
  });
}

/** Exclusão: confirma digitando o nome exato da loja; motivo obrigatório. Pedidos e lançamentos ficam. */
export async function deleteStoreAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Loja inválida." };
  const [store] = await sql<{ name: string }[]>`select name from stores where id = ${id.data}`;
  if (!store) return { error: "Loja não encontrada." };
  if (text(formData.get("confirmName"), 120) !== store.name) return { error: `Para confirmar, digite o nome da loja exatamente: ${store.name}` };
  const at = await now();
  return run(async () => {
    await sql.begin((tx) => closeStore(tx, { storeId: id.data, by: "admin", reason: text(formData.get("reason"), 500), actorId: profile.id, at }));
    return "Loja excluída. Os pedidos e os valores continuam guardados.";
  });
}
