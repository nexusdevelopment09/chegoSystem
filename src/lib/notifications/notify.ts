import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import type { Channel } from "./outbound";

type Db = postgres.Sql | postgres.TransactionSql;

export type Notice = {
  profileIds: string[];
  type: string;
  title: string;
  body: string;
  link?: string | null;
  orderId?: string | null;
  promotional?: boolean;
  /** Besides the in-app bell. Simulated in the test environment. */
  channels?: Channel[];
  at?: Date;
};

/**
 * Records a notification for each person (the bell inside the app) and
 * "sends" it on the other channels. Promotional notices respect the
 * customer's preference; order notices always go out.
 */
export async function notify(notice: Notice, db: Db = sql) {
  if (notice.profileIds.length === 0) return;

  const recipients = await db<{ id: string; full_name: string; phone: string | null; email: string | null }[]>`
    select id, full_name, phone, email
    from profiles
    where id = any(${notice.profileIds}::uuid[])
      and deleted_at is null
      ${notice.promotional ? db`and promo_notifications` : db``}`;

  const at = notice.at ?? new Date();
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

/** Owner and attendants of a store. */
export async function storeStaffIds(storeId: string, db: Db = sql, roles = ["owner", "attendant"]): Promise<string[]> {
  const rows = await db<{ profile_id: string }[]>`
    select profile_id from store_members where store_id = ${storeId} and role::text = any(${roles})`;
  return rows.map((row) => row.profile_id);
}

export async function adminIds(db: Db = sql): Promise<string[]> {
  const rows = await db<{ id: string }[]>`select id from profiles where role = 'admin' and deleted_at is null`;
  return rows.map((row) => row.id);
}
