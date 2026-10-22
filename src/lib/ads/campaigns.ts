import "server-only";
import { sql } from "@/lib/db";
import { toLocal } from "@/lib/time";

// Anúncios das lojas. Regras:
// - só aparece campanha "ativa" dentro do horário (início ≤ agora < fim), de loja ativa e não excluída;
//   a vitrine confere o horário a cada página, então campanha vencida nunca é exibida;
// - maior prioridade primeiro; empate, a que começou antes;
// - toda loja anunciada leva o selo "Patrocinado" e o anúncio nunca mexe na nota nem nas avaliações;
// - impressões e cliques são contadores por dia, sem guardar quem viu.

export const PLACEMENT_LABELS = {
  inicio: "Destaque na página inicial",
  topo: "Primeiras posições da lista",
  categoria: "Destaque dentro de uma categoria",
  promocional: "Campanha promocional por período",
} as const;
export type Placement = keyof typeof PLACEMENT_LABELS;

export const AD_STATUS_LABELS = { ativa: "Ativa", pausada: "Pausada", encerrada: "Encerrada" } as const;

/** Cookie do último clique em anúncio: "<campanha>.<instante>". Vale 24 horas. */
export const AD_COOKIE = "chego_ad";
export const AD_ATTRIBUTION_MS = 24 * 3_600_000;

export type LiveCampaign = { campaignId: string; storeId: string; placement: Placement; priority: number; title: string };

/** Campanhas no ar agora, numa cidade, nos lugares pedidos (e, para "categoria", no segmento). */
export async function liveCampaigns(input: { cityId: string; at: Date; placements: Placement[]; categoryId?: string | null }): Promise<LiveCampaign[]> {
  const rows = await sql<{ id: string; store_id: string; placement: Placement; priority: number; title: string }[]>`
    select c.id, c.store_id, c.placement, c.priority, c.title
    from ad_campaigns c join stores s on s.id = c.store_id
    where c.status = 'ativa' and c.starts_at <= ${input.at} and c.ends_at > ${input.at}
      and c.placement = any(${input.placements}::ad_placement[])
      and s.city_id = ${input.cityId} and s.status = 'active' and s.closed_at is null
      ${input.categoryId ? sql`and (c.placement <> 'categoria' or c.category_id = ${input.categoryId})` : sql`and c.placement <> 'categoria'`}
    order by c.priority desc, c.starts_at, c.id`;
  // Uma loja aparece uma vez por lugar: vale a campanha de maior prioridade.
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const key = `${row.placement}:${row.store_id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ campaignId: row.id, storeId: row.store_id, placement: row.placement, priority: row.priority, title: row.title }];
  });
}

/** Conta uma exibição para cada campanha mostrada na página. */
export async function recordImpressions(campaignIds: string[], at: Date) {
  const ids = [...new Set(campaignIds)];
  if (ids.length === 0) return;
  const day = toLocal(at).date;
  await sql`
    insert into ad_daily_stats (campaign_id, day, impressions)
    select id, ${day}::date, 1 from unnest(${ids}::uuid[]) as id
    on conflict (campaign_id, day) do update set impressions = ad_daily_stats.impressions + 1`;
}

/** Para onde o anúncio leva: a página da loja (null se a campanha ou a loja não existirem mais). */
export async function campaignTarget(campaignId: string): Promise<string | null> {
  const [campaign] = await sql<{ slug: string }[]>`
    select s.slug from ad_campaigns c join stores s on s.id = c.store_id where c.id = ${campaignId} and s.closed_at is null`;
  return campaign ? `/loja/${campaign.slug}` : null;
}

/** Conta um clique na campanha. */
export async function recordClick(campaignId: string, at: Date) {
  await sql`
    insert into ad_daily_stats (campaign_id, day, clicks) values (${campaignId}, ${toLocal(at).date}::date, 1)
    on conflict (campaign_id, day) do update set clicks = ad_daily_stats.clicks + 1`;
}

/** A campanha do clique, se ainda vale para um pedido nesta loja (mesma loja, até 24 h depois). */
export async function attributedCampaign(cookieValue: string | undefined, storeId: string, at: Date): Promise<string | null> {
  const [campaignId, clickedAt] = (cookieValue ?? "").split(".");
  if (!/^[0-9a-f-]{36}$/i.test(campaignId ?? "") || !/^\d+$/.test(clickedAt ?? "")) return null;
  if (at.getTime() - Number(clickedAt) > AD_ATTRIBUTION_MS || Number(clickedAt) > at.getTime() + 60_000) return null;
  const [row] = await sql`select 1 from ad_campaigns where id = ${campaignId} and store_id = ${storeId}`;
  return row ? campaignId : null;
}
