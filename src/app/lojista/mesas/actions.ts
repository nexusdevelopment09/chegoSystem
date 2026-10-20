"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { parseMoney } from "@/lib/format";
import { addBillItem, addBillPayment, BillError, cancelBill, cancelBillItem, cancelBillPayment, closeBill, openBill } from "@/lib/tables/bills";
import { StockError } from "@/lib/inventory/stock";

// Mesas e vendas de balcão. Registrar venda pede "vendas.presenciais"; cadastrar mesas,
// "mesas.gerenciar"; cancelar itens e pagamentos, "vendas.descontos". Tudo com auditoria.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const done = () => revalidatePath("/lojista", "layout");
const fail = (error: unknown): ActionState => {
  if (error instanceof BillError || error instanceof StockError) return { error: error.message };
  if ((error as { code?: string }).code === "23505") return { error: "Já existe uma mesa com esse nome, ou a mesa já tem conta aberta." };
  throw error;
};
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const actorOf = async (permission: Parameters<typeof requirePermission>[0]) => {
  const { profile, membership } = await requirePermission(permission);
  return { profileId: profile.id, role: membership.role, storeId: membership.storeId };
};

export async function saveTable(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("mesas.gerenciar");
  const id = uuid.safeParse(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim().slice(0, 30);
  if (!label) return { error: "Diga o número ou o nome da mesa." };
  try {
    if (id.success) {
      await sql`update store_tables set label = ${label} where id = ${id.data} and store_id = ${actor.storeId}`;
    } else {
      await sql`insert into store_tables (store_id, label, sort_order) values (${actor.storeId}, ${label}, (select coalesce(max(sort_order), 0) + 1 from store_tables where store_id = ${actor.storeId}))`;
    }
  } catch (error) {
    return fail(error);
  }
  await audit({ actorId: actor.profileId, actorRole: actor.role, action: id.success ? "mesas.mesa_editada" : "mesas.mesa_criada", module: "mesas", entityType: "store_table", entityId: id.success ? id.data : null, storeId: actor.storeId, details: { mesa: label } });
  done();
  return { ok: true, message: "Mesa salva." };
}

export async function toggleTable(formData: FormData): Promise<void> {
  const actor = await actorOf("mesas.gerenciar");
  const id = uuid.parse(formData.get("id"));
  const [open] = await sql`select 1 from table_bills where table_id = ${id} and status = 'aberta'`;
  if (open) return;
  const rows = await sql`update store_tables set active = not active where id = ${id} and store_id = ${actor.storeId} returning active`;
  if (rows.length > 0) await audit({ actorId: actor.profileId, actorRole: actor.role, action: rows[0].active ? "mesas.mesa_ativada" : "mesas.mesa_desativada", module: "mesas", entityType: "store_table", entityId: id, storeId: actor.storeId });
  done();
}

export async function openTableBill(formData: FormData): Promise<void> {
  const actor = await actorOf("vendas.presenciais");
  const tableId = uuid.safeParse(formData.get("tableId")).success ? String(formData.get("tableId")) : null;
  const customerName = String(formData.get("customerName") ?? "").trim().slice(0, 60) || null;
  const at = await now();
  let billId: string | null = null;
  try {
    billId = await sql.begin((tx) => openBill(tx, actor, { tableId, customerName, at }));
  } catch (error) {
    if (!(error instanceof BillError) && (error as { code?: string }).code !== "23505") throw error;
    // Corrida: alguém abriu a mesma mesa agora. Leva para a conta que já está aberta.
    const [open] = tableId ? await sql<{ id: string }[]>`select id from table_bills where table_id = ${tableId} and status = 'aberta'` : [];
    billId = open?.id ?? null;
  }
  done();
  redirect(billId ? `/lojista/mesas/conta/${billId}` : "/lojista/mesas");
}

export async function addItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("vendas.presenciais");
  const billId = uuid.safeParse(formData.get("billId"));
  const productId = uuid.safeParse(formData.get("productId"));
  if (!billId.success || !productId.success) return { error: "Escolha o produto." };
  const quantity = Number(formData.get("quantity") ?? 1);
  const picks = z.array(z.object({ groupId: uuid, optionId: uuid, quantity: z.number().int().min(1).max(20) })).max(40)
    .safeParse(parseJson(String(formData.get("picks") || "[]")));
  if (!picks.success) return { error: "Escolhas inválidas." };
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 200) || null;
  try {
    const at = await now();
    await sql.begin((tx) => addBillItem(tx, actor, { billId: billId.data, productId: productId.data, quantity, notes, picks: picks.data, at }));
  } catch (error) {
    return fail(error);
  }
  done();
  return { ok: true, message: "Item adicionado." };
}

export async function cancelItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("vendas.descontos");
  const itemId = uuid.safeParse(formData.get("itemId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!itemId.success) return { error: "Item inválido." };
  if (reason.length < 3) return { error: "Informe o motivo do cancelamento." };
  try {
    await sql.begin((tx) => cancelBillItem(tx, actor, { itemId: itemId.data, reason }));
  } catch (error) {
    return fail(error);
  }
  done();
  return { ok: true, message: "Item cancelado." };
}

export async function addPayment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("vendas.presenciais");
  const billId = uuid.safeParse(formData.get("billId"));
  const method = z.enum(["pix", "card", "cash"]).safeParse(formData.get("method"));
  const amount = parseMoney(String(formData.get("amount") ?? ""));
  if (!billId.success || !method.success) return { error: "Escolha a forma de pagamento." };
  if (amount === null) return { error: "Valor inválido. Use o formato 12,50." };
  try {
    await sql.begin((tx) => addBillPayment(tx, actor, { billId: billId.data, method: method.data, amountCents: amount }));
  } catch (error) {
    return fail(error);
  }
  done();
  return { ok: true, message: "Pagamento registrado." };
}

export async function cancelPayment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("vendas.descontos");
  const paymentId = uuid.safeParse(formData.get("paymentId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!paymentId.success) return { error: "Pagamento inválido." };
  if (reason.length < 3) return { error: "Informe o motivo." };
  try {
    await sql.begin((tx) => cancelBillPayment(tx, actor, { paymentId: paymentId.data, reason }));
  } catch (error) {
    return fail(error);
  }
  done();
  return { ok: true, message: "Pagamento cancelado." };
}

export async function closeTableBill(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("vendas.presenciais");
  const billId = uuid.safeParse(formData.get("billId"));
  if (!billId.success) return { error: "Conta inválida." };
  let result: { code: string; changeCents: number };
  try {
    const at = await now();
    result = await sql.begin((tx) => closeBill(tx, actor, { billId: billId.data, at }));
  } catch (error) {
    return fail(error);
  }
  done();
  const change = result.changeCents > 0 ? ` Troco: R$ ${(result.changeCents / 100).toFixed(2).replace(".", ",")}.` : "";
  return { ok: true, message: `Conta fechada: pedido ${result.code}.${change} A mesa está livre.` };
}

export async function cancelTableBill(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await actorOf("vendas.descontos");
  const billId = uuid.safeParse(formData.get("billId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!billId.success) return { error: "Conta inválida." };
  if (reason.length < 3) return { error: "Informe o motivo." };
  try {
    await sql.begin((tx) => cancelBill(tx, actor, { billId: billId.data, reason }));
  } catch (error) {
    return fail(error);
  }
  done();
  redirect("/lojista/mesas");
}
