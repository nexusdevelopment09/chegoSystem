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

/** Envia mensagens para fora do app. Trocado por NOTIFICATION_PROVIDER no futuro. */
export interface NotificationProvider {
  send(message: OutboundMessage): Promise<void>;
}

/**
 * Ambiente de testes: nada sai do computador. Toda mensagem é guardada e
 * mostrada na "Caixa de mensagens" da página /dev.
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
