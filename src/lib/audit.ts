import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";

type Db = postgres.Sql | postgres.TransactionSql;

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  storeId?: string | null;
  /** Papel de quem agiu, no momento da ação (owner, attendant, courier, admin...). */
  actorRole?: string | null;
  /** Módulo do painel: estoque, mesas, equipe, pedidos, cardapio, financeiro... */
  module?: string | null;
  result?: "ok" | "negado" | "erro";
  /** Motivo informado nas operações sensíveis (perda, ajuste, cancelamento). */
  reason?: string | null;
  /** Processo automático responsável, quando não foi uma pessoa. */
  process?: string | null;
  /** Valores antes e depois (nunca senhas, códigos ou tokens). */
  details?: Record<string, unknown>;
};

/**
 * Registra uma ação: quem, com que papel, o quê, em quê, em que loja e com que resultado.
 * Os eventos não podem ser alterados nem apagados (regra no banco). Passe a transação da
 * operação para que mudança e registro aconteçam juntos (ou nenhum dos dois).
 */
export async function audit(entry: AuditEntry, db: Db = sql) {
  await db`
    insert into audit_logs (actor_id, action, entity_type, entity_id, store_id, actor_role, module, result, reason, process, details)
    values (${entry.actorId}, ${entry.action}, ${entry.entityType}, ${entry.entityId ?? null}, ${entry.storeId ?? null},
            ${entry.actorRole ?? null}, ${entry.module ?? entry.action.split(".")[0]}, ${entry.result ?? "ok"},
            ${entry.reason ?? null}, ${entry.process ?? null}, ${db.json((entry.details ?? {}) as never)})`;
}
