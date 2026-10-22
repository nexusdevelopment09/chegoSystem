import "server-only";
import type postgres from "postgres";
import { audit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { adminIds, notify, storeStaffIds } from "@/lib/notifications/notify";

// Situação da conta de uma loja: ativar, desativar, suspender (com prazo ou não), reativar e
// encerrar (exclusão lógica). Tudo numa transação, com histórico de situação e auditoria.
// Encerrar nunca apaga pedidos, taxas nem lançamentos: a loja só sai do ar.

type Tx = postgres.TransactionSql;
export class AccountError extends Error {}

type StoreState = { id: string; name: string; status: "pending" | "active" | "paused" | "suspended"; closed_at: Date | null };

const IN_PROGRESS = ["awaiting_payment", "paid", "accepted", "preparing", "ready", "out_for_delivery"];

async function lockStore(tx: Tx, storeId: string): Promise<StoreState> {
  const [store] = await tx<StoreState[]>`select id, name, status, closed_at from stores where id = ${storeId} for update`;
  if (!store) throw new AccountError("Loja não encontrada.");
  if (store.closed_at) throw new AccountError("Esta loja foi excluída. Nada mais pode ser alterado nela.");
  return store;
}

async function event(tx: Tx, input: { storeId: string; kind: string; from?: string | null; to?: string | null; reason?: string | null; actorId?: string | null; process?: string | null; at: Date }) {
  await tx`
    insert into store_status_events (store_id, kind, from_status, to_status, reason, actor_id, process, created_at)
    values (${input.storeId}, ${input.kind}, ${input.from ?? null}, ${input.to ?? null}, ${input.reason ?? null}, ${input.actorId ?? null}, ${input.process ?? null}, ${input.at})`;
}

/** Registra um evento de histórico fora destas operações (cadastro, aprovação). */
export const recordStoreEvent = event;

/** Ativa (volta ao ar) ou desativa administrativamente (pausada: some da vitrine aberta, sem suspensão). */
export async function setStoreActive(tx: Tx, input: { storeId: string; active: boolean; reason: string; actorId: string; at: Date }) {
  const store = await lockStore(tx, input.storeId);
  if (store.status === "pending") throw new AccountError("Aprove a loja antes de ativar ou desativar.");
  if (store.status === "suspended") throw new AccountError("A loja está suspensa. Use “Reativar conta” para encerrar a suspensão.");
  const to = input.active ? "active" : "paused";
  if (store.status === to) throw new AccountError(input.active ? "A loja já está ativa." : "A loja já está desativada.");
  if (!input.active && input.reason.trim().length < 3) throw new AccountError("Para desativar, escreva o motivo.");

  await tx`update stores set status = ${to}::store_status where id = ${store.id}`;
  await tx`update store_private set status_reason = ${input.active ? null : input.reason} where store_id = ${store.id}`;
  await event(tx, { storeId: store.id, kind: input.active ? "ativada" : "desativada", from: store.status, to, reason: input.reason || null, actorId: input.actorId, at: input.at });
  await audit({ actorId: input.actorId, actorRole: "admin", module: "lojas", action: input.active ? "loja.ativada" : "loja.desativada", entityType: "store", entityId: store.id, storeId: store.id,
    reason: input.reason || null, details: { antes: store.status, depois: to } }, tx);
}

export type SuspensionInput = {
  storeId: string; reason: string; description: string | null; startsAt: Date; endsAt: Date | null; notifyOwner: boolean; actorId: string; at: Date;
};

/** Suspende a conta. Com início no futuro, fica agendada e as tarefas automáticas aplicam na hora. */
export async function suspendStore(tx: Tx, input: SuspensionInput): Promise<{ applied: boolean }> {
  const store = await lockStore(tx, input.storeId);
  if (store.status === "pending") throw new AccountError("Loja pendente não pode ser suspensa: recuse ou aprove primeiro.");
  if (input.reason.trim().length < 3) throw new AccountError("Informe o motivo da suspensão.");
  if (input.endsAt && input.endsAt <= input.startsAt) throw new AccountError("O fim da suspensão precisa ser depois do início.");
  if (input.endsAt && input.endsAt <= input.at) throw new AccountError("O fim da suspensão já passou.");
  const [open] = await tx`select 1 from store_suspensions where store_id = ${store.id} and lifted_at is null`;
  if (open || store.status === "suspended") throw new AccountError("Esta loja já tem uma suspensão em aberto.");

  const applied = input.startsAt <= input.at;
  const [created] = await tx<{ id: string }[]>`
    insert into store_suspensions (store_id, reason, description, starts_at, ends_at, notify_owner, previous_status, applied_at, created_by, created_at)
    values (${store.id}, ${input.reason.trim()}, ${input.description}, ${input.startsAt}, ${input.endsAt}, ${input.notifyOwner},
            ${store.status}::store_status, ${applied ? input.at : null}, ${input.actorId}, ${input.at})
    returning id`;
  if (applied) await applySuspension(tx, { storeId: store.id, from: store.status, suspensionId: created.id, reason: input.reason, endsAt: input.endsAt, notifyOwner: input.notifyOwner, actorId: input.actorId, at: input.at });
  await audit({ actorId: input.actorId, actorRole: "admin", module: "lojas", action: applied ? "loja.suspensa" : "loja.suspensao_agendada", entityType: "store", entityId: store.id, storeId: store.id,
    reason: input.reason, details: { descricao: input.description, inicio: input.startsAt.toISOString(), fim: input.endsAt?.toISOString() ?? "indeterminado", avisar: input.notifyOwner } }, tx);
  return { applied };
}

async function applySuspension(tx: Tx, input: { storeId: string; from: string; suspensionId: string; reason: string; endsAt: Date | null; notifyOwner: boolean; actorId: string | null; at: Date; process?: string }) {
  await tx`update stores set status = 'suspended' where id = ${input.storeId}`;
  await tx`update store_private set status_reason = ${input.reason} where store_id = ${input.storeId}`;
  await event(tx, { storeId: input.storeId, kind: "suspensa", from: input.from, to: "suspended", reason: input.reason, actorId: input.actorId, process: input.process ?? null, at: input.at });
  if (input.notifyOwner) {
    await notify({
      profileIds: await storeStaffIds(input.storeId, tx, ["owner"]), type: "store_suspended", title: "Sua loja foi suspensa",
      body: `Motivo: ${input.reason}.${input.endsAt ? " A suspensão tem prazo para acabar." : ""} Fale com o suporte do Chegô.`, link: "/lojista/financeiro", channels: ["sms", "email"], at: input.at,
    }, tx);
  }
}

/** Encerra a suspensão em aberto (aplicada ou agendada) e devolve a loja à situação de antes. */
export async function liftSuspension(tx: Tx, input: { storeId: string; reason: string; actorId: string | null; at: Date; process?: string }) {
  const store = await lockStore(tx, input.storeId);
  const [open] = await tx<{ id: string; previous_status: "active" | "paused"; applied_at: Date | null; notify_owner: boolean }[]>`
    select id, previous_status, applied_at, notify_owner from store_suspensions where store_id = ${store.id} and lifted_at is null for update`;
  if (!open) throw new AccountError("Esta loja não tem suspensão em aberto.");
  if (input.reason.trim().length < 3) throw new AccountError("Informe o motivo da reativação.");

  await tx`update store_suspensions set lifted_at = ${input.at}, lifted_by = ${input.actorId}, lift_reason = ${input.reason} where id = ${open.id}`;
  if (open.applied_at && store.status === "suspended") {
    await tx`update stores set status = ${open.previous_status}::store_status where id = ${store.id}`;
    await tx`update store_private set status_reason = null where store_id = ${store.id}`;
    await event(tx, { storeId: store.id, kind: "reativada", from: "suspended", to: open.previous_status, reason: input.reason, actorId: input.actorId, process: input.process ?? null, at: input.at });
    if (open.notify_owner) {
      await notify({ profileIds: await storeStaffIds(store.id, tx, ["owner"]), type: "store_reactivated", title: "Sua loja voltou ao ar", body: "A suspensão foi encerrada.", link: "/lojista", at: input.at }, tx);
    }
  }
  await audit({ actorId: input.actorId, actorRole: input.actorId ? "admin" : null, process: input.process ?? null, module: "lojas", action: "loja.reativada", entityType: "store", entityId: store.id, storeId: store.id,
    reason: input.reason, details: { suspensao: open.id, volta_para: open.previous_status, agendada: !open.applied_at } }, tx);
}

/**
 * Exclusão lógica: a loja sai do ar e do painel do lojista para sempre; pedidos, taxas e lançamentos
 * ficam guardados (obrigações fiscais e de prestação de contas). Pedido em andamento impede.
 */
export async function closeStore(tx: Tx, input: { storeId: string; by: "empresa" | "admin"; reason: string; actorId: string; at: Date }) {
  const store = await lockStore(tx, input.storeId);
  if (input.reason.trim().length < 3) throw new AccountError("Informe o motivo da exclusão.");
  const [busy] = await tx`select 1 from orders where store_id = ${store.id} and status::text = any(${IN_PROGRESS}) limit 1`;
  if (busy) throw new AccountError("A loja tem pedido em andamento. Espere os pedidos terminarem antes de excluir.");
  const [openBill] = await tx`select 1 from table_bills where store_id = ${store.id} and status = 'aberta' limit 1`;
  if (openBill) throw new AccountError("A loja tem conta de mesa aberta. Feche ou cancele antes de excluir.");

  await tx`update store_suspensions set lifted_at = ${input.at}, lifted_by = ${input.actorId}, lift_reason = 'Conta excluída' where store_id = ${store.id} and lifted_at is null`;
  await tx`update ad_campaigns set status = 'encerrada', ended_at = ${input.at}, updated_at = ${input.at} where store_id = ${store.id} and status <> 'encerrada'`;
  await tx`
    update stores set status = 'suspended', closed_at = ${input.at}, closed_reason = ${input.reason.trim()}, closed_by_kind = ${input.by}, closed_by = ${input.actorId}
    where id = ${store.id}`;
  await tx`update store_private set status_reason = ${input.reason.trim()} where store_id = ${store.id}`;
  await tx`delete from sessions where profile_id in (select profile_id from store_members where store_id = ${store.id} and role <> 'owner')`;
  await event(tx, { storeId: store.id, kind: input.by === "empresa" ? "encerrada_pela_empresa" : "excluida", from: store.status, to: "excluida", reason: input.reason, actorId: input.actorId, at: input.at });
  await audit({ actorId: input.actorId, actorRole: input.by === "empresa" ? "owner" : "admin", module: "lojas", action: input.by === "empresa" ? "loja.encerrada_pela_empresa" : "loja.excluida",
    entityType: "store", entityId: store.id, storeId: store.id, reason: input.reason, details: { loja: store.name, situacao_anterior: store.status } }, tx);
  await notify(input.by === "empresa"
    ? { profileIds: await adminIds(tx), type: "store_closed", title: "Uma loja encerrou a conta", body: `${store.name}: ${input.reason}`, link: `/admin/lojas/${store.id}`, at: input.at }
    : { profileIds: await storeStaffIds(store.id, tx, ["owner"]), type: "store_closed", title: "Sua loja foi excluída do Chegô", body: `Motivo: ${input.reason}. Fale com o suporte para dúvidas.`, channels: ["sms", "email"], at: input.at }, tx);
}

/** Tarefa automática: aplica suspensões agendadas que começaram e encerra as que venceram. */
export async function runSuspensionSchedule(at: Date): Promise<{ applied: number; lifted: number }> {
  let applied = 0;
  let lifted = 0;
  const due = await sql<{ id: string; store_id: string }[]>`
    select id, store_id from store_suspensions where lifted_at is null and applied_at is null and starts_at <= ${at}`;
  for (const row of due) {
    await sql.begin(async (tx) => {
      const [item] = await tx<{ id: string; reason: string; ends_at: Date | null; notify_owner: boolean }[]>`
        select id, reason, ends_at, notify_owner from store_suspensions where id = ${row.id} and lifted_at is null and applied_at is null for update`;
      const [store] = await tx<{ status: string; closed_at: Date | null }[]>`select status, closed_at from stores where id = ${row.store_id} for update`;
      if (!item || !store || store.closed_at) return;
      // Se a suspensão também já venceu, nem chega a tirar a loja do ar.
      if (item.ends_at && item.ends_at <= at) {
        await tx`update store_suspensions set applied_at = ${at}, lifted_at = ${at}, lift_reason = 'Fim do prazo' where id = ${item.id}`;
        return;
      }
      await tx`update store_suspensions set applied_at = ${at} where id = ${item.id}`;
      await applySuspension(tx, { storeId: row.store_id, from: store.status, suspensionId: item.id, reason: item.reason, endsAt: item.ends_at, notifyOwner: item.notify_owner, actorId: null, at, process: "suspensão agendada" });
      applied += 1;
    });
  }
  const expired = await sql<{ store_id: string }[]>`
    select store_id from store_suspensions where lifted_at is null and applied_at is not null and ends_at is not null and ends_at <= ${at}`;
  for (const row of expired) {
    try {
      await sql.begin((tx) => liftSuspension(tx, { storeId: row.store_id, reason: "Fim do prazo da suspensão", actorId: null, at, process: "fim do prazo" }));
      lifted += 1;
    } catch (error) {
      if (!(error instanceof AccountError)) throw error;
    }
  }
  return { applied, lifted };
}
