import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import type { Channel } from "./outbound";
import { sendPush } from "./push";

type Db = postgres.Sql | postgres.TransactionSql;

export type Notice = {
  /** Nulos são ignorados (ex.: o cliente de um pedido feito sem conta, que acompanha pelo link). */
  profileIds: (string | null)[];
  type: string;
  title: string;
  body: string;
  link?: string | null;
  orderId?: string | null;
  promotional?: boolean;
  /** Além do sino dentro do app. Simulado no ambiente de testes. */
  channels?: Channel[];
  at?: Date;
};

/**
 * Grava uma notificação para cada pessoa (o sino dentro do app) e a
 * "envia" pelos outros canais. Avisos promocionais respeitam a preferência
 * do cliente; avisos de pedido sempre saem.
 */
export async function notify(notice: Notice, db: Db = sql) {
  const ids = notice.profileIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;

  const recipients = await db<{ id: string; full_name: string; phone: string | null; email: string | null }[]>`
    select id, full_name, phone, email
    from profiles
    where id = any(${ids}::uuid[])
      and deleted_at is null
      ${notice.promotional ? db`and promo_notifications` : db``}`;

  const at = notice.at ?? new Date();
  if (notice.channels?.includes("push")) {
    // Sem esperar de propósito: o serviço de push fica na internet e não pode atrasar o pedido.
    void sendPush(recipients.map((person) => person.id), { title: notice.title, body: notice.body, url: notice.link });
  }
  for (const person of recipients) {
    await db`
      insert into notifications (profile_id, type, title, body, link, order_id, promotional, created_at)
      values (${person.id}, ${notice.type}, ${notice.title}, ${notice.body}, ${notice.link ?? null},
              ${notice.orderId ?? null}, ${notice.promotional ?? false}, ${at})`;

    for (const channel of notice.channels ?? []) {
      const recipient = channel === "email" ? person.email : channel === "push" ? person.full_name : person.phone;
      if (!recipient) continue;
      await db`
        insert into outbound_messages (channel, recipient, profile_id, subject, body, created_at)
        values (${channel}::message_channel, ${recipient}, ${person.id},
                ${channel === "sms" || channel === "whatsapp" ? null : notice.title},
                ${channel === "sms" || channel === "whatsapp" ? `Chegô: ${notice.title}. ${notice.body}` : notice.body},
                ${at})`;
    }
  }
}

/** Dono e atendentes de uma loja. */
export async function storeStaffIds(storeId: string, db: Db = sql, roles = ["owner", "attendant"]): Promise<string[]> {
  const rows = await db<{ profile_id: string }[]>`
    select profile_id from store_members where store_id = ${storeId} and role::text = any(${roles})`;
  return rows.map((row) => row.profile_id);
}

export async function adminIds(db: Db = sql): Promise<string[]> {
  const rows = await db<{ id: string }[]>`select id from profiles where role = 'admin' and deleted_at is null`;
  return rows.map((row) => row.id);
}

/** Entregadores da rede do Chegô aprovados e disponíveis agora em uma cidade. */
export async function availableCourierIds(cityId: string, db: Db = sql): Promise<string[]> {
  const rows = await db<{ profile_id: string }[]>`
    select profile_id from couriers where city_id = ${cityId} and status = 'active' and available`;
  return rows.map((row) => row.profile_id);
}
