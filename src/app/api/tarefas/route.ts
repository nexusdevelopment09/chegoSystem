import { timingSafeEqual } from "node:crypto";
import { now } from "@/lib/clock";
import { isLocalEnv } from "@/lib/env";
import { runScheduledTasks } from "@/lib/tasks/run";

/**
 * Roda as tarefas agendadas que estão na hora (expirar pedidos não pagos, recusar
 * pedidos que ninguém aceitou, lembretes, faturas...). Pode ser chamada quantas vezes quiser.
 *
 * No ambiente de testes qualquer pessoa neste computador pode chamar. Em qualquer
 * outro lugar quem chama precisa mandar o segredo no cabeçalho "x-cron-secret".
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
