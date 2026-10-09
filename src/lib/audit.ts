import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";

type Db = postgres.Sql | postgres.TransactionSql;

/** Records a sensitive action of an admin or a store user: who, what, on what. */
export async function audit(
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; storeId?: string | null; details?: Record<string, unknown> },
  db: Db = sql,
) {
  await db`
    insert into audit_logs (actor_id, action, entity_type, entity_id, store_id, details)
    values (${entry.actorId}, ${entry.action}, ${entry.entityType}, ${entry.entityId ?? null}, ${entry.storeId ?? null},
            ${db.json((entry.details ?? {}) as never)})`;
}
