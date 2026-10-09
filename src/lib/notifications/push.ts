import "server-only";
import webpush from "web-push";
import { sql } from "@/lib/db";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
export const pushConfigured = Boolean(publicKey && privateKey);

if (pushConfigured) {
  webpush.setVapidDetails("mailto:suporte@chego.local", publicKey!, privateKey!);
}

export type PushPayload = { title: string; body: string; url?: string | null };

/**
 * Sends a real browser notification to every device the person turned
 * notifications on for. Never throws: a notification that fails must not
 * break what the user was doing. Devices that no longer exist are forgotten.
 */
export async function sendPush(profileIds: string[], payload: PushPayload): Promise<void> {
  if (!pushConfigured || profileIds.length === 0) return;
  try {
    const subscriptions = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
      select id, endpoint, p256dh, auth from push_subscriptions where profile_id = any(${profileIds}::uuid[])`;

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          { TTL: 600 },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await sql`delete from push_subscriptions where id = ${subscription.id}`;
        }
      }
    }));
  } catch (error) {
    console.error("[push] could not send", error);
  }
}
