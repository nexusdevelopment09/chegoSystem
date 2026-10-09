import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { sql } from "@/lib/db";

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(5).max(300) }),
});

/** Saves this browser as a place to send the signed-in user's notifications. */
export async function PUT(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  await sql`
    insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
    values (${profile.id}, ${parsed.data.endpoint}, ${parsed.data.keys.p256dh}, ${parsed.data.keys.auth},
            ${request.headers.get("user-agent")?.slice(0, 300) ?? null})
    on conflict (endpoint) do update set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth`;
  return Response.json({ saved: true });
}

export async function DELETE(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  const parsed = z.object({ endpoint: z.url().max(1000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  await sql`delete from push_subscriptions where endpoint = ${parsed.data.endpoint} and profile_id = ${profile.id}`;
  return Response.json({ removed: true });
}
