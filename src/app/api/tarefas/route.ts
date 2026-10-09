import { timingSafeEqual } from "node:crypto";
import { now } from "@/lib/clock";
import { isLocalEnv } from "@/lib/env";
import { runScheduledTasks } from "@/lib/tasks/run";

/**
 * Runs the scheduled tasks that are due (expire unpaid orders, refuse orders
 * nobody accepted, reminders, invoices...). Safe to call as often as wanted.
 *
 * In the test environment anyone on this computer can call it. Anywhere
 * else the caller must send the secret in the "x-cron-secret" header.
 */
export async function POST(request: Request) {
  if (!isLocalEnv) {
    const secret = process.env.CRON_SECRET ?? "";
    const sent = request.headers.get("x-cron-secret") ?? "";
    const valid = secret.length >= 16 && sent.length === secret.length && timingSafeEqual(Buffer.from(sent), Buffer.from(secret));
    if (!valid) return new Response("Unauthorized", { status: 401 });
  }

  try {
    return Response.json({ ok: true, report: await runScheduledTasks(await now()) });
  } catch (error) {
    console.error("[tasks] failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
