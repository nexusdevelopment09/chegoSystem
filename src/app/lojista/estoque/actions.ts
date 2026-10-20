"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type postgres from "postgres";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { parseMoney } from "@/lib/format";
import { parseQuantity, type MovementKind } from "@/lib/inventory/rules";
import { auditMovement, recordMovement, StockError } from "@/lib/inventory/stock";
import { suggestions } from "@/lib/inventory/queries";
import { now } from "@/lib/clock";

// Estoque da loja. Cada ação confere a permissão no servidor e grava movimentação e
// auditoria na mesma transação. Ninguém edita o saldo direto: ajuste vira movimentação.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const UNITS = ["un", "kg", "g", "l", "ml", "pacote", "caixa"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const done = () => revalidatePath("/lojista", "layout");
const text = (value: FormDataEntryValue | null, max: number) => String(value ?? "").trim().slice(0, max) || null;
const failure = (error: unknown): ActionState => {
  if (error instanceof StockError) return { error: error.message };
  if ((error as { code?: string }).code === "23505") return { error: "Já existe um item com esse código (SKU) ou esse produto já está ligado a outro item." };
  throw error;
};

export async function saveStockItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("estoque.ajustar");
  const id = uuid.safeParse(formData.get("id"));
  const name = text(formData.get("name"), 120);
  if (!name) return { error: "Diga o nome do item." };
  const unit = z.enum(UNITS).safeParse(formData.get("unit"));
  if (!unit.success) return { error: "Escolha a unidade de medida." };
  const min = parseQuantity(String(formData.get("minQuantity") ?? "")) ?? 0;
  const ideal = parseQuantity(String(formData.get("idealQuantity") ?? ""));
  const costText = String(formData.get("unitCost") ?? "").trim();
  const cost = costText ? parseMoney(costText) : null;
  if (costText && cost === null) return { error: "Custo inválido. Use o formato 12,50." };
  const lead = String(formData.get("leadTimeDays") ?? "").trim();
  const leadDays = lead ? Number(lead) : null;
  if (leadDays !== null && (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365)) return { error: "Prazo do fornecedor inválido (em dias)." };
  if (min < 0 || (ideal !== null && ideal < 0)) return { error: "Quantidades não podem ser negativas." };
  const status = z.enum(["ativo", "inativo", "indisponivel"]).catch("ativo").parse(formData.get("status"));
  const productId = uuid.safeParse(formData.get("productId")).success ? String(formData.get("productId")) : null;
  const fields = {
    name, category: text(formData.get("category"), 60), sku: text(formData.get("sku"), 40), unit: unit.data, min_quantity: min, ideal_quantity: ideal,
    unit_cost_cents: cost, supplier: text(formData.get("supplier"), 120), lead_time_days: leadDays, storage_location: text(formData.get("storageLocation"), 60),
    perishable: formData.get("perishable") === "on", status, updated_at: await now(),
  };

  let itemId: string;
  try {
    itemId = await sql.begin(async (tx) => {
      if (productId) {
        const [product] = await tx`select 1 from products where id = ${productId} and store_id = ${membership.storeId} and deleted_at is null`;
        if (!product) throw new StockError("Produto não encontrado nesta loja.");
      }
      let savedId: string;
      if (id.success) {
        const [before] = await tx<{ product_id: string | null }[]>`select product_id from stock_items where id = ${id.data} and store_id = ${membership.storeId}`;
        if (!before) throw new StockError("Item não encontrado.");
        await tx`update stock_items set ${tx(fields)}, product_id = ${productId} where id = ${id.data}`;
        savedId = id.data;
        if (productId && productId !== before.product_id) await linkProduct(tx, membership.storeId, savedId, productId, profile.id);
      } else {
        const [created] = await tx<{ id: string }[]>`insert into stock_items ${tx({ ...fields, store_id: membership.storeId })} returning id`;
        savedId = created.id;
        const initial = parseQuantity(String(formData.get("initialQuantity") ?? "")) ?? 0;
        if (initial < 0) throw new StockError("O saldo inicial não pode ser negativo.");
        if (productId) {
          await tx`update stock_items set product_id = ${productId} where id = ${savedId}`;
          await linkProduct(tx, membership.storeId, savedId, productId, profile.id, initial);
        } else if (initial > 0) {
          await recordMovement(tx, { storeId: membership.storeId, itemId: savedId, kind: "ajuste", quantity: initial, reason: "Saldo inicial", createdBy: profile.id });
        }
      }
      await audit({
        actorId: profile.id, actorRole: membership.role, action: id.success ? "estoque.item_editado" : "estoque.item_criado", module: "estoque",
        entityType: "stock_item", entityId: savedId, storeId: membership.storeId, details: { nome: name, minimo: min, unidade: unit.data, produto: productId },
      }, tx);
      return savedId;
    });
  } catch (error) {
    return failure(error);
  }
  done();
  if (!id.success) redirect(`/lojista/estoque/${itemId}`);
  return { ok: true, message: "Item salvo." };
}

/**
 * Liga o item a um produto do cardápio: o saldo dos dois passa a andar junto e o produto
 * esgota sozinho quando o estoque zera. Se o produto já controlava estoque, o item assume o
 * saldo dele; senão o produto passa a usar o saldo do item.
 */
async function linkProduct(tx: postgres.TransactionSql, storeId: string, itemId: string, productId: string, profileId: string, initial = 0) {
  const [product] = await tx<{ track_stock: boolean; stock_qty: number | null }[]>`select track_stock, stock_qty from products where id = ${productId}`;
  const [item] = await tx<{ quantity: string }[]>`select quantity::text from stock_items where id = ${itemId}`;
  if (product.track_stock) {
    const diff = (product.stock_qty ?? 0) - Number(item.quantity);
    if (diff !== 0) await recordMovement(tx, { storeId, itemId, kind: "ajuste", quantity: diff, reason: "Ligado ao produto do cardápio: saldo do cardápio", createdBy: profileId, syncProduct: false });
  } else {
    if (initial > 0) await recordMovement(tx, { storeId, itemId, kind: "ajuste", quantity: initial, reason: "Saldo inicial", createdBy: profileId, syncProduct: false });
    const [after] = await tx<{ quantity: string }[]>`select quantity::text from stock_items where id = ${itemId}`;
    await tx`update products set track_stock = true, stock_qty = ${Math.max(0, Math.floor(Number(after.quantity)))} where id = ${productId}`;
  }
}

/** Permissão de cada tipo de movimentação manual. */
const MOVEMENT_PERMISSION = { compra: "estoque.movimentar", perda: "estoque.perdas", vencido: "estoque.perdas", ajuste: "estoque.ajustar" } as const;

export async function registerMovement(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const kind = z.enum(["compra", "perda", "vencido", "ajuste"]).safeParse(formData.get("kind"));
  if (!kind.success) return { error: "Escolha o tipo de movimentação." };
  const { profile, membership } = await requirePermission(MOVEMENT_PERMISSION[kind.data]);
  const itemId = uuid.safeParse(formData.get("itemId"));
  if (!itemId.success) return { error: "Item inválido." };
  const amount = parseQuantity(String(formData.get("quantity") ?? ""));
  const reason = text(formData.get("reason"), 300);
  if (amount === null) return { error: kind.data === "ajuste" ? "Diga a quantidade contada." : "Diga a quantidade." };
  if (kind.data !== "ajuste" && amount <= 0) return { error: "A quantidade precisa ser maior que zero." };
  if (kind.data === "ajuste" && amount < 0) return { error: "A contagem não pode ser negativa." };
  if (kind.data !== "compra" && !reason) return { error: "Informe o motivo." };
  const lotId = uuid.safeParse(formData.get("lotId")).success ? String(formData.get("lotId")) : null;
  const expiresAt = String(formData.get("expiresAt") ?? "");
  const manufacturedAt = String(formData.get("manufacturedAt") ?? "");
  const costText = String(formData.get("cost") ?? "").trim();
  const cost = costText ? parseMoney(costText) : null;
  if (costText && cost === null) return { error: "Custo inválido. Use o formato 12,50." };
  const at = await now();

  try {
    await sql.begin(async (tx) => {
      let quantity = kind.data === "compra" ? amount : -amount;
      if (kind.data === "ajuste") {
        // Ajuste de inventário: a pessoa informa a contagem real; a diferença vira a movimentação.
        const [item] = await tx<{ quantity: string }[]>`select quantity::text from stock_items where id = ${itemId.data} and store_id = ${membership.storeId} for update`;
        if (!item) throw new StockError("Item não encontrado.");
        quantity = Math.round((amount - Number(item.quantity)) * 1000) / 1000;
        if (quantity === 0) throw new StockError("A contagem é igual ao saldo: nada a ajustar.");
      }
      const result = await recordMovement(tx, {
        storeId: membership.storeId, itemId: itemId.data, kind: kind.data as MovementKind, quantity, reason: reason ?? (kind.data === "compra" ? "Compra / reposição" : null),
        lotId, createdBy: profile.id,
        newLot: kind.data === "compra" && (DATE.test(expiresAt) || formData.get("perishable") === "on")
          ? { expiresAt: DATE.test(expiresAt) ? expiresAt : null, manufacturedAt: DATE.test(manufacturedAt) ? manufacturedAt : null, supplier: text(formData.get("supplier"), 120), costCents: cost, receivedAt: at.toISOString().slice(0, 10) }
          : undefined,
      });
      if (!result) throw new StockError("Nada foi registrado.");
      if (kind.data === "compra" && cost !== null && amount > 0) {
        await tx`update stock_items set unit_cost_cents = ${Math.round(cost / amount)} where id = ${itemId.data}`;
      }
      await auditMovement(tx, { actorId: profile.id, actorRole: membership.role, storeId: membership.storeId, itemId: itemId.data, kind: kind.data as MovementKind, quantity, reason, balance: result.balance });
    });
  } catch (error) {
    return failure(error);
  }
  done();
  return { ok: true, message: "Movimentação registrada." };
}

/** Descarta o que sobrou de um lote (vencido ou estragado). Fica registrado como saída. */
export async function discardLot(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("estoque.perdas");
  const lotId = uuid.safeParse(formData.get("lotId"));
  if (!lotId.success) return { error: "Lote inválido." };
  if (formData.get("confirm") !== "on") return { error: "Marque a confirmação do descarte." };
  const reason = text(formData.get("reason"), 300) ?? "Lote vencido descartado";
  try {
    await sql.begin(async (tx) => {
      const [lot] = await tx<{ item_id: string; remaining_quantity: string }[]>`
        select item_id, remaining_quantity::text from stock_lots where id = ${lotId.data} and store_id = ${membership.storeId} and discarded_at is null for update`;
      if (!lot) throw new StockError("Lote não encontrado ou já descartado.");
      const remaining = Number(lot.remaining_quantity);
      if (remaining > 0) {
        const result = await recordMovement(tx, { storeId: membership.storeId, itemId: lot.item_id, kind: "vencido", quantity: -remaining, reason, lotId: lotId.data, createdBy: profile.id });
        if (result) await auditMovement(tx, { actorId: profile.id, actorRole: membership.role, storeId: membership.storeId, itemId: lot.item_id, kind: "vencido", quantity: -remaining, reason, balance: result.balance });
      }
      await tx`update stock_lots set discarded_at = now(), remaining_quantity = 0 where id = ${lotId.data}`;
      await tx`update stock_alerts set resolved_at = now() where lot_id = ${lotId.data} and resolved_at is null`;
    });
  } catch (error) {
    return failure(error);
  }
  done();
  return { ok: true, message: "Descarte registrado." };
}

export async function resolveAlert(formData: FormData): Promise<void> {
  const { profile, membership } = await requirePermission("estoque.movimentar");
  const id = uuid.parse(formData.get("id"));
  const rows = await sql`update stock_alerts set resolved_at = now() where id = ${id} and store_id = ${membership.storeId} and kind = 'conferir' and resolved_at is null returning id`;
  if (rows.length > 0) await audit({ actorId: profile.id, actorRole: membership.role, action: "estoque.alerta_conferido", module: "estoque", entityType: "stock_alert", entityId: id, storeId: membership.storeId });
  done();
}

export async function saveStockSettings(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("estoque.ajustar");
  const days = String(formData.get("warningDays") ?? "").split(/[,\s;]+/).filter(Boolean).map(Number);
  if (days.length === 0 || days.length > 6 || days.some((day) => !Number.isInteger(day) || day < 1 || day > 365)) {
    return { error: "Avisos de validade: de 1 a 6 números de dias, separados por vírgula (ex.: 30, 15, 7, 3)." };
  }
  const allowNegative = formData.get("allowNegative") === "on";
  const sorted = [...new Set(days)].sort((a, b) => b - a);
  await sql`
    insert into store_stock_settings (store_id, expiry_warning_days, allow_negative) values (${membership.storeId}, ${sorted}, ${allowNegative})
    on conflict (store_id) do update set expiry_warning_days = excluded.expiry_warning_days, allow_negative = excluded.allow_negative, updated_at = now()`;
  await audit({ actorId: profile.id, actorRole: membership.role, action: "estoque.configuracao", module: "estoque", entityType: "store", entityId: membership.storeId, storeId: membership.storeId, details: { avisos: sorted, negativo: allowNegative } });
  done();
  return { ok: true, message: "Configuração salva." };
}

// ------------------------------------------------------------------ ficha técnica

export async function saveRecipeLine(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("produtos.editar");
  const productId = uuid.safeParse(formData.get("productId"));
  const itemId = uuid.safeParse(formData.get("itemId"));
  const optionId = uuid.safeParse(formData.get("optionId")).success ? String(formData.get("optionId")) : null;
  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (!productId.success || !itemId.success) return { error: "Escolha o insumo." };
  if (quantity === null || quantity <= 0) return { error: "Diga quanto do insumo vai em uma unidade." };
  const [valid] = await sql`
    select 1 from products p join stock_items i on i.store_id = p.store_id
    where p.id = ${productId.data} and i.id = ${itemId.data} and p.store_id = ${membership.storeId}
      ${optionId ? sql`and exists (select 1 from product_option_groups pog join options o on o.group_id = pog.group_id where pog.product_id = p.id and o.id = ${optionId})` : sql``}`;
  if (!valid) return { error: "Produto, opção ou insumo não encontrado nesta loja." };
  await sql`
    insert into recipe_lines (store_id, product_id, option_id, item_id, quantity) values (${membership.storeId}, ${productId.data}, ${optionId}, ${itemId.data}, ${quantity})
    on conflict (product_id, coalesce(option_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id) do update set quantity = excluded.quantity`;
  await audit({ actorId: profile.id, actorRole: membership.role, action: "estoque.ficha_tecnica", module: "estoque", entityType: "product", entityId: productId.data, storeId: membership.storeId, details: { insumo: itemId.data, opcao: optionId, quantidade: quantity } });
  done();
  return { ok: true, message: "Ficha técnica salva." };
}

export async function deleteRecipeLine(formData: FormData): Promise<void> {
  const { membership } = await requirePermission("produtos.editar");
  await sql`delete from recipe_lines where id = ${uuid.parse(formData.get("id"))} and store_id = ${membership.storeId}`;
  done();
}

// ------------------------------------------------------------------ lista de compras

/** Monta uma lista de compras com as sugestões (rascunho: nada é comprado sem aprovação). */
export async function createPurchaseList(): Promise<void> {
  const { profile, membership } = await requirePermission("reposicao.ver");
  const items = (await suggestions(membership.storeId, await now())).filter((item) => item.suggested > 0);
  const listId = await sql.begin(async (tx) => {
    const [list] = await tx<{ id: string }[]>`insert into purchase_lists (store_id, created_by) values (${membership.storeId}, ${profile.id}) returning id`;
    for (const item of items) {
      await tx`
        insert into purchase_list_items (list_id, item_id, suggested_quantity, quantity, unit_cost_cents, reason)
        values (${list.id}, ${item.id}, ${item.suggested}, ${item.suggested}, ${item.unitCostCents}, ${item.reason})`;
    }
    await audit({ actorId: profile.id, actorRole: membership.role, action: "estoque.lista_criada", module: "estoque", entityType: "purchase_list", entityId: list.id, storeId: membership.storeId, details: { itens: items.length } }, tx);
    return list.id;
  });
  done();
  redirect(`/lojista/estoque/reposicao/${listId}`);
}

export async function updatePurchaseItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { membership } = await requirePermission("reposicao.ver");
  const id = uuid.safeParse(formData.get("id"));
  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (!id.success || quantity === null || quantity < 0) return { error: "Quantidade inválida." };
  const rows = await sql`
    update purchase_list_items li set quantity = ${quantity}
    from purchase_lists l where l.id = li.list_id and li.id = ${id.data} and l.store_id = ${membership.storeId} and l.status = 'rascunho'
    returning li.id`;
  if (rows.length === 0) return { error: "Só listas em rascunho podem ser editadas." };
  done();
  return { ok: true, message: "Quantidade salva." };
}

/** Aprovação humana da lista (não compra nada: só marca que a loja vai comprar). */
export async function approvePurchaseList(formData: FormData): Promise<void> {
  const { profile, membership } = await requirePermission("estoque.ajustar");
  const id = uuid.parse(formData.get("id"));
  const rows = await sql`update purchase_lists set status = 'aprovada', approved_by = ${profile.id}, approved_at = now() where id = ${id} and store_id = ${membership.storeId} and status = 'rascunho' returning id`;
  if (rows.length > 0) await audit({ actorId: profile.id, actorRole: membership.role, action: "estoque.lista_aprovada", module: "estoque", entityType: "purchase_list", entityId: id, storeId: membership.storeId });
  done();
}

/** A compra chegou: cada item vira uma entrada de estoque (uma vez só). */
export async function receivePurchaseList(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await requirePermission("estoque.movimentar");
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Lista inválida." };
  try {
    await sql.begin(async (tx) => {
      const [list] = await tx`select id from purchase_lists where id = ${id.data} and store_id = ${membership.storeId} and status = 'aprovada' for update`;
      if (!list) throw new StockError("Só listas aprovadas podem ser recebidas (e uma vez só).");
      const items = await tx<{ item_id: string; quantity: string }[]>`select item_id, quantity::text from purchase_list_items where list_id = ${id.data} and quantity > 0`;
      for (const item of items) {
        const result = await recordMovement(tx, { storeId: membership.storeId, itemId: item.item_id, kind: "compra", quantity: Number(item.quantity), reason: "Lista de compras recebida", createdBy: profile.id });
        if (result) await auditMovement(tx, { actorId: profile.id, actorRole: membership.role, storeId: membership.storeId, itemId: item.item_id, kind: "compra", quantity: Number(item.quantity), reason: "Lista de compras recebida", balance: result.balance });
      }
      await tx`update purchase_lists set status = 'recebida', received_at = now() where id = ${id.data}`;
    });
  } catch (error) {
    return failure(error);
  }
  done();
  return { ok: true, message: "Entrada registrada no estoque." };
}

export async function cancelPurchaseList(formData: FormData): Promise<void> {
  const { profile, membership } = await requirePermission("reposicao.ver");
  const id = uuid.parse(formData.get("id"));
  const rows = await sql`update purchase_lists set status = 'cancelada' where id = ${id} and store_id = ${membership.storeId} and status in ('rascunho', 'aprovada') returning id`;
  if (rows.length > 0) await audit({ actorId: profile.id, actorRole: membership.role, action: "estoque.lista_cancelada", module: "estoque", entityType: "purchase_list", entityId: id, storeId: membership.storeId });
  done();
}
