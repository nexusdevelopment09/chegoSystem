"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { requestJob } from "@/lib/printing/jobs";

// Impressoras térmicas da loja. O dono cadastra e configura; dono e atendente imprimem.
// Toda consulta confere a loja de quem pediu (store_id = a do painel).

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const printerSchema = z.object({
  id: z.union([uuid, z.literal("")]),
  name: z.string().trim().min(1, "Dê um nome para a impressora.").max(60),
  sector: z.enum(["caixa", "cozinha", "expedicao", "geral"]),
  kind: z.enum(["completo", "cozinha", "comprovante"]),
  width: z.enum(["58", "80"]),
  copies: z.coerce.number().int().min(1).max(5),
  encoding: z.enum(["cp860", "cp850", "ascii"]),
});

const done = () => revalidatePath("/lojista", "layout");

export async function savePrinter(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("loja.config");
  const parsed = printerSchema.safeParse({
    id: formData.get("id") ?? "", name: formData.get("name"), sector: formData.get("sector"), kind: formData.get("kind"),
    width: formData.get("width"), copies: formData.get("copies") || 1, encoding: formData.get("encoding"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;
  const auto = formData.get("autoPrint") === "on";
  const makeDefault = formData.get("isDefault") === "on";
  const at = await now();

  await sql.begin(async (tx) => {
    if (makeDefault) await tx`update store_printers set is_default = false where store_id = ${membership.storeId}`;
    const fields = {
      name: data.name, sector: data.sector, print_kind: data.kind, paper_width_mm: Number(data.width), copies: data.copies,
      encoding: data.encoding, auto_print: auto, updated_at: at,
    };
    let id = data.id;
    if (id) {
      // Ligar a impressão automática agora: só os pedidos que chegarem daqui em diante.
      const updated = await tx`
        update store_printers set ${tx(fields)},
          auto_since = case when ${auto} and not auto_print then ${at} when ${auto} then auto_since else null end
          ${makeDefault ? tx`, is_default = true` : tx``}
        where id = ${id} and store_id = ${membership.storeId} returning id`;
      if (updated.length === 0) throw new Error("not found");
    } else {
      const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from store_printers where store_id = ${membership.storeId}`;
      const [created] = await tx<{ id: string }[]>`
        insert into store_printers ${tx({ ...fields, store_id: membership.storeId, auto_since: auto ? at : null, is_default: makeDefault || count === 0 })}
        returning id`;
      id = created.id;
    }
    await audit({ actorId: profile.id, action: data.id ? "printer.update" : "printer.create", entityType: "store_printer", entityId: id, storeId: membership.storeId }, tx);
  });
  done();
  return { ok: true, message: data.id ? "Impressora salva." : "Impressora cadastrada. Agora conecte pelo Bluetooth neste celular." };
}

export async function deletePrinter(formData: FormData): Promise<void> {
  const { profile, membership } = await requirePermission("loja.config");
  const id = uuid.parse(formData.get("id"));
  const removed = await sql`delete from store_printers where id = ${id} and store_id = ${membership.storeId} returning is_default`;
  // Sem padrão, a primeira que sobrou vira a padrão.
  if (removed[0]?.is_default) {
    await sql`update store_printers set is_default = true where id = (select id from store_printers where store_id = ${membership.storeId} order by created_at limit 1)`;
  }
  if (removed.length > 0) await audit({ actorId: profile.id, action: "printer.delete", entityType: "store_printer", entityId: id, storeId: membership.storeId });
  done();
}

/** Grava em qual celular a impressora foi conectada (o aparelho manda o próprio id). */
export async function bindPrinterToDevice(input: { printerId: string; deviceId: string; deviceLabel: string }): Promise<ActionState> {
  const { membership } = await requirePermission("pedidos.ver");
  const parsed = z.object({ printerId: uuid, deviceId: uuid, deviceLabel: z.string().trim().max(60) }).safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const rows = await sql`
    update store_printers set device_id = ${parsed.data.deviceId}, device_label = ${parsed.data.deviceLabel || null}, updated_at = ${await now()}
    where id = ${parsed.data.printerId} and store_id = ${membership.storeId} returning id`;
  if (rows.length === 0) return { error: "Impressora não encontrada." };
  done();
  return { ok: true };
}

/**
 * Imprimir agora (teste ou reimpressão de um pedido). Cria um trabalho na fila; o celular
 * da impressora pega na hora. Sem impressora escolhida, vai para a padrão.
 */
export async function requestPrint(input: { printerId?: string; orderId?: string; kind?: "completo" | "cozinha" | "comprovante" | "teste" }): Promise<ActionState & { jobId?: string; printerId?: string }> {
  const { profile, membership } = await requirePermission("pedidos.ver");
  const printerId = input.printerId && uuid.safeParse(input.printerId).success ? input.printerId
    : (await sql<{ id: string }[]>`select id from store_printers where store_id = ${membership.storeId} order by is_default desc, created_at limit 1`)[0]?.id;
  if (!printerId) return { error: "Cadastre uma impressora em Impressoras." };
  const orderId = input.orderId && uuid.safeParse(input.orderId).success ? input.orderId : null;
  let kind = input.kind ?? "completo";
  if (!input.kind && orderId) {
    const [printer] = await sql<{ print_kind: "completo" | "cozinha" | "comprovante" }[]>`select print_kind from store_printers where id = ${printerId} and store_id = ${membership.storeId}`;
    kind = printer?.print_kind ?? "completo";
  }
  if (kind !== "teste" && !orderId) return { error: "Pedido inválido." };
  const jobId = await requestJob({ storeId: membership.storeId, printerId, orderId: kind === "teste" ? null : orderId, kind, profileId: profile.id });
  if (!jobId) return { error: "Impressora ou pedido não encontrado." };
  return { ok: true, jobId, printerId };
}
