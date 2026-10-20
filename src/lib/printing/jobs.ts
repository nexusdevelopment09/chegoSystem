import "server-only";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { loadOrder } from "@/lib/orders/queries";
import type { Encoding } from "./escpos";
import { buildCopies, buildTestReceipt, type PrintKind } from "./receipt";

// Fila de impressão. O servidor cria os trabalhos (um por impressora, pedido e tipo), o
// celular da impressora pega os seus de forma atômica, imprime e conta o resultado.
// Ninguém imprime o mesmo trabalho duas vezes: recarregar a página, abrir duas abas ou
// reconectar não duplica, porque pegar um trabalho o tira da fila na mesma consulta.

export type PrinterRow = {
  id: string; store_id: string; name: string; sector: "caixa" | "cozinha" | "expedicao" | "geral"; print_kind: PrintKind;
  paper_width_mm: 58 | 80; copies: number; encoding: Encoding; auto_print: boolean; auto_since: Date | null; is_default: boolean;
  device_id: string | null; device_label: string | null;
};

export type ClaimedJob = { id: string; printerId: string; printerName: string; kind: PrintKind | "teste"; orderCode: string | null; bytes: string };

/** Quanto tempo um trabalho pode ficar "enviando" sem resposta antes de virar "resultado desconhecido". */
const STALE_MS = 2 * 60_000;
/** Só pedidos recentes entram na impressão automática (nunca o histórico). */
const AUTO_WINDOW_MS = 12 * 60 * 60_000;

export async function listPrinters(storeId: string): Promise<PrinterRow[]> {
  return sql<PrinterRow[]>`
    select id, store_id, name, sector, print_kind, paper_width_mm, copies, encoding, auto_print, auto_since, is_default, device_id, device_label
    from store_printers where store_id = ${storeId} order by is_default desc, created_at`;
}

/**
 * Cria os trabalhos automáticos que faltam para as impressoras deste aparelho: pedidos que
 * chegaram (pagos) depois de ligar a impressão automática. O índice único garante um só.
 */
export async function ensureAutoJobs(storeId: string, deviceId: string, at: Date) {
  await sql`
    insert into print_jobs (store_id, printer_id, order_id, kind)
    select p.store_id, p.id, o.id, p.print_kind
    from store_printers p
    join orders o on o.store_id = p.store_id
    where p.store_id = ${storeId} and p.device_id = ${deviceId} and p.auto_print
      and o.paid_at is not null and o.paid_at >= p.auto_since and o.paid_at >= ${new Date(at.getTime() - AUTO_WINDOW_MS)}
      and o.status not in ('rejected', 'cancelled', 'expired', 'awaiting_payment')
    on conflict (printer_id, order_id, kind) where not reprint and order_id is not null do nothing`;
}

/** Trabalhos presos em "enviando" (o celular fechou no meio) viram "resultado desconhecido". */
async function markStale(storeId: string, at: Date) {
  await sql`
    update print_jobs set status = 'unknown', finished_at = ${at}, error = 'Sem resposta do aparelho: confira se saiu e reimprima se precisar.'
    where store_id = ${storeId} and status = 'sending' and claimed_at < ${new Date(at.getTime() - STALE_MS)}`;
}

/** Pega (de forma atômica) os próximos trabalhos das impressoras deste aparelho e monta os bytes. */
export async function claimJobs(input: { storeId: string; deviceId: string; profileId: string; printerId?: string }): Promise<ClaimedJob[]> {
  const at = await now();
  await markStale(input.storeId, at);
  await ensureAutoJobs(input.storeId, input.deviceId, at);
  const claimed = await sql<{ id: string; printer_id: string; order_id: string | null; kind: PrintKind | "teste" }[]>`
    update print_jobs j set status = 'sending', claimed_at = ${at}, attempts = j.attempts + 1, device_id = ${input.deviceId}
    where j.id in (
      select j2.id from print_jobs j2 join store_printers p on p.id = j2.printer_id
      where j2.store_id = ${input.storeId} and j2.status = 'pending' and p.device_id = ${input.deviceId}
        ${input.printerId ? sql`and p.id = ${input.printerId}` : sql``}
      order by j2.created_at
      limit 5
      for update of j2 skip locked)
    returning j.id, j.printer_id, j.order_id, j.kind`;
  if (claimed.length === 0) return [];

  const printers = new Map((await listPrinters(input.storeId)).map((printer) => [printer.id, printer]));
  const [store] = await sql<{ name: string }[]>`select name from stores where id = ${input.storeId}`;
  const jobs: ClaimedJob[] = [];
  for (const job of claimed) {
    const printer = printers.get(job.printer_id)!;
    try {
      if (job.kind === "teste") {
        const bytes = buildTestReceipt({ storeName: store.name, printerName: printer.name, width: printer.paper_width_mm, encoding: printer.encoding, at });
        jobs.push({ id: job.id, printerId: printer.id, printerName: printer.name, kind: "teste", orderCode: null, bytes: Buffer.from(bytes).toString("base64") });
        continue;
      }
      // Lido com as permissões de quem está no painel: só pedidos da própria loja.
      const order = job.order_id ? await loadOrder(input.profileId, job.order_id) : null;
      if (!order || order.storeId !== input.storeId) throw new Error("Pedido não encontrado para esta loja.");
      const bytes = buildCopies(order, { storeName: store.name, kind: job.kind, width: printer.paper_width_mm, encoding: printer.encoding }, printer.copies);
      jobs.push({ id: job.id, printerId: printer.id, printerName: printer.name, kind: job.kind, orderCode: order.code, bytes: Buffer.from(bytes).toString("base64") });
    } catch (error) {
      await finishJob({ storeId: input.storeId, jobId: job.id, ok: false, error: (error as Error).message });
    }
  }
  return jobs;
}

/** O aparelho conta o que aconteceu. "Enviado" quer dizer que os bytes chegaram à impressora. */
export async function finishJob(input: { storeId: string; jobId: string; ok: boolean; error?: string }) {
  const at = await now();
  const rows = await sql`
    update print_jobs set status = ${input.ok ? "sent" : "failed"}::print_job_status, finished_at = ${at},
                          error = ${input.ok ? null : (input.error ?? "Falha ao enviar").slice(0, 300)}
    where id = ${input.jobId} and store_id = ${input.storeId} and status = 'sending'
    returning id`;
  return rows.length > 0;
}

/** Reimpressão manual ou teste: um trabalho novo, marcado como reimpressão. */
export async function requestJob(input: { storeId: string; printerId: string; orderId: string | null; kind: PrintKind | "teste"; profileId: string }) {
  const [printer] = await sql<{ id: string }[]>`select id from store_printers where id = ${input.printerId} and store_id = ${input.storeId}`;
  if (!printer) return null;
  if (input.orderId) {
    const [order] = await sql`select 1 from orders where id = ${input.orderId} and store_id = ${input.storeId} and paid_at is not null`;
    if (!order) return null;
  }
  const [job] = await sql<{ id: string }[]>`
    insert into print_jobs (store_id, printer_id, order_id, kind, reprint, requested_by)
    values (${input.storeId}, ${input.printerId}, ${input.orderId}, ${input.kind}::print_kind, true, ${input.profileId}) returning id`;
  return job.id;
}

export type JobView = { id: string; printer_name: string | null; order_code: string | null; kind: PrintKind | "teste"; reprint: boolean; status: "pending" | "sending" | "sent" | "failed" | "unknown"; error: string | null; created_at: Date; order_id: string | null; printer_id: string | null };

export async function recentJobs(storeId: string, filter: { orderId?: string; limit?: number } = {}): Promise<JobView[]> {
  return sql<JobView[]>`
    select j.id, p.name as printer_name, o.code as order_code, j.kind, j.reprint, j.status, j.error, j.created_at, j.order_id, j.printer_id
    from print_jobs j left join store_printers p on p.id = j.printer_id left join orders o on o.id = j.order_id
    where j.store_id = ${storeId} ${filter.orderId ? sql`and j.order_id = ${filter.orderId}` : sql``}
    order by j.created_at desc limit ${filter.limit ?? 30}`;
}
