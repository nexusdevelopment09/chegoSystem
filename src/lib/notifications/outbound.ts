import "server-only";
import { sql } from "@/lib/db";

export type Channel = "sms" | "whatsapp" | "email" | "push";

export type OutboundMessage = {
  channel: Channel;
  recipient: string;
  profileId?: string | null;
  subject?: string | null;
  body: string;
};

/** Sends messages outside the app. Swapped by NOTIFICATION_PROVIDER in the future. */
export interface NotificationProvider {
  send(message: OutboundMessage): Promise<void>;
}

/**
 * Test environment: nothing leaves the computer. Every message is stored and
 * shown in the "Caixa de mensagens" of the /dev page.
 */
class SimulatedNotificationProvider implements NotificationProvider {
  async send(message: OutboundMessage) {
    await sql`
      insert into outbound_messages (channel, recipient, profile_id, subject, body)
      values (
        ${message.channel}::message_channel, ${message.recipient}, ${message.profileId ?? null},
        ${message.subject ?? null}, ${message.body}
      )`;
  }
}

const provider: NotificationProvider = new SimulatedNotificationProvider();

export function sendOutbound(message: OutboundMessage) {
  return provider.send(message);
}
