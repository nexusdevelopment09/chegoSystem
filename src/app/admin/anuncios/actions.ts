"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PLACEMENT_LABELS } from "@/lib/ads/campaigns";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { parseMoney } from "@/lib/format";
import { fromLocal } from "@/lib/time";

// Campanhas de anúncio: só o super admin cria, pausa, retoma e encerra. Tudo na auditoria.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const localDateTime = (value: string) => fromLocal(value.slice(0, 10), Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16)));
const done = () => { revalidatePath("/admin", "layout"); revalidatePath("/"); };

const schema = z.object({
  storeId: z.uuid("Escolha a loja."),
  title: z.string().trim().min(3, "Dê um nome para a campanha.").max(80),
  placement: z.enum(Object.keys(PLACEMENT_LABELS) as [keyof typeof PLACEMENT_LABELS, ...(keyof typeof PLACEMENT_LABELS)[]]),
  categoryId: z.union([z.uuid(), z.literal("")]),
  priority: z.coerce.number().int().min(1, "Prioridade de 1 a 100.").max(100, "Prioridade de 1 a 100."),
  startsAt: z.string().regex(DATETIME, "Informe o início."),
  endsAt: z.string().regex(DATETIME, "Informe o fim."),
  notes: z.string().trim().max(500),
});

export async function createCampaign(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const parsed = schema.safeParse(Object.fromEntries(["storeId", "title", "placement", "categoryId", "priority", "startsAt", "endsAt", "notes"].map((key) => [key, formData.get(key) ?? ""])));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;
  const price = parseMoney(String(formData.get("price") ?? "0") || "0");
  if (price === null || price < 0) return { error: "Valor cobrado inválido. Use o formato 150,00." };
  const startsAt = localDateTime(data.startsAt);
  const endsAt = localDateTime(data.endsAt);
  const at = await now();
  if (endsAt <= startsAt) return { error: "O fim precisa ser depois do início." };
  if (endsAt <= at) return { error: "O fim já passou." };
  if (data.placement === "categoria" && !data.categoryId) return { error: "Escolha a categoria do destaque." };

  const [store] = await sql<{ name: string; category_id: string }[]>`
    select name, category_id from stores where id = ${data.storeId} and closed_at is null and status <> 'pending'`;
  if (!store) return { error: "Loja não encontrada ou não aprovada." };
  // Destaque de categoria só no segmento da própria loja.
  const categoryId = data.placement === "categoria" ? data.categoryId : null;
  if (categoryId && categoryId !== store.category_id) return { error: "A loja só pode ser destacada na categoria dela." };

  await sql.begin(async (tx) => {
    const [created] = await tx<{ id: string }[]>`
      insert into ad_campaigns (store_id, title, placement, category_id, priority, starts_at, ends_at, price_cents, notes, created_by, created_at, updated_at)
      values (${data.storeId}, ${data.title}, ${data.placement}, ${categoryId}, ${data.priority}, ${startsAt}, ${endsAt}, ${price}, ${data.notes || null}, ${profile.id}, ${at}, ${at})
      returning id`;
    await audit({ actorId: profile.id, actorRole: "admin", module: "anuncios", action: "anuncio.criado", entityType: "ad_campaign", entityId: created.id, storeId: data.storeId,
      details: { loja: store.name, titulo: data.title, lugar: data.placement, prioridade: data.priority, inicio: startsAt.toISOString(), fim: endsAt.toISOString(), valor_cents: price } }, tx);
  });
  done();
  return { ok: true, message: `Campanha criada para ${store.name}.` };
}

/** Pausar, retomar ou encerrar. Encerrada não volta. */
export async function setCampaignStatus(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const id = z.uuid().safeParse(formData.get("id"));
  const to = z.enum(["ativa", "pausada", "encerrada"]).safeParse(formData.get("status"));
  if (!id.success || !to.success) return { error: "Dados inválidos." };
  const at = await now();
  const result = await sql.begin(async (tx) => {
    const [campaign] = await tx<{ status: string; store_id: string; ends_at: Date }[]>`select status, store_id, ends_at from ad_campaigns where id = ${id.data} for update`;
    if (!campaign) return "Campanha não encontrada.";
    if (campaign.status === "encerrada") return "Campanha encerrada não pode ser alterada.";
    if (to.data === "ativa" && campaign.ends_at <= at) return "O período da campanha já acabou.";
    if (campaign.status === to.data) return null;
    await tx`
      update ad_campaigns set status = ${to.data}::ad_status, updated_at = ${at}, ended_at = ${to.data === "encerrada" ? at : null}
      where id = ${id.data}`;
    await audit({ actorId: profile.id, actorRole: "admin", module: "anuncios", action: `anuncio.${to.data === "ativa" ? "retomado" : to.data === "pausada" ? "pausado" : "encerrado"}`,
      entityType: "ad_campaign", entityId: id.data, storeId: campaign.store_id, details: { antes: campaign.status, depois: to.data } }, tx);
    return null;
  });
  if (result) return { error: result };
  done();
  return { ok: true, message: to.data === "ativa" ? "Campanha retomada." : to.data === "pausada" ? "Campanha pausada." : "Campanha encerrada." };
}
