import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { AD_STATUS_LABELS, PLACEMENT_LABELS, type Placement } from "@/lib/ads/campaigns";
import { adminContext } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { toLocal } from "@/lib/time";
import { createCampaign, setCampaignStatus } from "./actions";

export const metadata: Metadata = { title: "Anúncios e impulsionamentos" };

type SearchParams = Promise<Record<string, string | undefined>>;
const FILTERS = { no_ar: "No ar agora", agendadas: "Agendadas", pausadas: "Pausadas", encerradas: "Encerradas", todas: "Todas" } as const;

export default function AdsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Ads searchParams={searchParams} />
    </Suspense>
  );
}

const localInput = (date: Date) => {
  const local = toLocal(date);
  return `${local.date}T${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`;
};

type Campaign = {
  id: string; store_id: string; store_name: string; title: string; placement: Placement; category: string | null; priority: number; starts_at: Date; ends_at: Date;
  status: keyof typeof AD_STATUS_LABELS; price_cents: number; notes: string | null; created_by: string | null; created_at: Date;
  impressions: number; clicks: number; orders: number; sales_cents: number;
};

async function Ads({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { superAdmin, at, cities, cityId, range } = await adminContext(params);
  const filter = params.ver && params.ver in FILTERS ? (params.ver as keyof typeof FILTERS) : "no_ar";

  const statusSql = {
    no_ar: sql`c.status = 'ativa' and c.starts_at <= ${at} and c.ends_at > ${at}`,
    agendadas: sql`c.status = 'ativa' and c.starts_at > ${at}`,
    pausadas: sql`c.status = 'pausada'`,
    encerradas: sql`(c.status = 'encerrada' or c.ends_at <= ${at})`,
    todas: sql`true`,
  }[filter];
  const [campaigns, [period], stores, categories] = await Promise.all([
    sql<Campaign[]>`
      select c.id, c.store_id, s.name as store_name, c.title, c.placement, cat.name as category, c.priority, c.starts_at, c.ends_at, c.status, c.price_cents, c.notes,
             p.full_name as created_by, c.created_at,
             coalesce((select sum(d.impressions) from ad_daily_stats d where d.campaign_id = c.id), 0)::int as impressions,
             coalesce((select sum(d.clicks) from ad_daily_stats d where d.campaign_id = c.id), 0)::int as clicks,
             (select count(*)::int from orders o where o.ad_campaign_id = c.id and o.paid_at is not null) as orders,
             (select coalesce(sum(o.total_cents - o.refunded_cents), 0)::bigint::int from orders o where o.ad_campaign_id = c.id and o.paid_at is not null
               and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')) as sales_cents
      from ad_campaigns c join stores s on s.id = c.store_id left join categories cat on cat.id = c.category_id left join profiles p on p.id = c.created_by
      where ${statusSql} ${cityId ? sql`and s.city_id = ${cityId}` : sql``}
      order by (c.status = 'ativa') desc, c.priority desc, c.starts_at desc limit 200`,
    sql<{ created: number; revenue: number; impressions: number; clicks: number; orders: number }[]>`
      select (select count(*)::int from ad_campaigns c join stores s on s.id = c.store_id where c.created_at >= ${range.from} and c.created_at < ${range.to} ${cityId ? sql`and s.city_id = ${cityId}` : sql``}) as created,
             (select coalesce(sum(c.price_cents), 0)::bigint::int from ad_campaigns c join stores s on s.id = c.store_id where c.created_at >= ${range.from} and c.created_at < ${range.to} ${cityId ? sql`and s.city_id = ${cityId}` : sql``}) as revenue,
             (select coalesce(sum(d.impressions), 0)::int from ad_daily_stats d where d.day between ${range.firstDay}::date and ${range.lastDay}::date) as impressions,
             (select coalesce(sum(d.clicks), 0)::int from ad_daily_stats d where d.day between ${range.firstDay}::date and ${range.lastDay}::date) as clicks,
             (select count(*)::int from orders o where o.ad_campaign_id is not null and o.paid_at >= ${range.from} and o.paid_at < ${range.to}) as orders`,
    sql<{ id: string; name: string; category: string }[]>`
      select s.id, s.name, c.name as category from stores s join categories c on c.id = s.category_id
      where s.closed_at is null and s.status in ('active', 'paused') ${cityId ? sql`and s.city_id = ${cityId}` : sql``} order by s.name`,
    sql<{ id: string; name: string }[]>`select id, name from categories where active order by sort_order`,
  ]);
  const live = campaigns.filter((item) => item.status === "ativa" && item.starts_at <= at && item.ends_at > at).length;
  const here = (ver: string) => withQuery("/admin/anuncios", { ...range.query, cidade: cityId, ver });
  const ctr = (clicks: number, impressions: number) => (impressions === 0 ? "—" : `${((clicks / impressions) * 100).toFixed(1).replace(".", ",")}%`);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Anúncios e impulsionamentos</h1>
      <p className="text-coffee-soft">
        Loja anunciada aparece com o selo <strong>Patrocinado</strong>. O anúncio muda só a posição: a nota e as avaliações continuam as reais.
        Campanha vencida sai do ar sozinha.
      </p>
      <RangeFilter path="/admin/anuncios" range={range} cities={cities} cityId={cityId} keep={{ ver: filter }} />

      <KpiGrid>
        <Kpi label="Campanhas criadas no período" value={period.created} />
        <Kpi label="Receita de anúncios" value={formatCents(period.revenue)} hint="Valor cobrado das campanhas criadas no período" />
        <Kpi label="Impressões" value={period.impressions.toLocaleString("pt-BR")} hint="Vezes que as lojas anunciadas apareceram" />
        <Kpi label="Cliques" value={period.clicks.toLocaleString("pt-BR")} hint={`Taxa de clique ${ctr(period.clicks, period.impressions)}`} />
        <Kpi label="Pedidos atribuídos" value={period.orders} hint="Pedido na loja até 24 h depois do clique" />
      </KpiGrid>

      {superAdmin ? (
        <details className="rounded-card bg-white p-4 ring-1 ring-peach">
          <summary className="min-h-11 cursor-pointer content-center text-xl font-semibold">Nova campanha</summary>
          <ActionForm action={createCampaign} className="mt-2 grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Loja
              <select name="storeId" required defaultValue="" className={inputClass}>
                <option value="" disabled>Escolha</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.category}</option>)}
              </select>
            </label>
            <Field label="Nome da campanha" name="title" required maxLength={80} placeholder="Ex.: Semana da pizza" />
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Onde aparece
              <select name="placement" defaultValue="inicio" className={inputClass}>
                {Object.entries(PLACEMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">Categoria (só para destaque na categoria)
              <select name="categoryId" defaultValue="" className={inputClass}>
                <option value="">—</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <Field label="Prioridade (1 a 100)" name="priority" type="number" min={1} max={100} defaultValue={50} hint="Maior aparece antes." />
            <Field label="Valor cobrado (R$)" name="price" inputMode="decimal" defaultValue="0,00" hint="Cobrado da loja por fora do app." />
            <Field label="Início" name="startsAt" type="datetime-local" required defaultValue={localInput(at)} />
            <Field label="Fim" name="endsAt" type="datetime-local" required defaultValue={localInput(new Date(at.getTime() + 7 * 86_400_000))} />
            <label className="flex flex-col gap-1.5 text-sm font-semibold sm:col-span-2">Observações<input name="notes" maxLength={500} className={inputClass} /></label>
            <SubmitButton className="self-start">Criar campanha</SubmitButton>
          </ActionForm>
        </details>
      ) : <p className="text-sm text-coffee-soft">Só o super admin cria e altera campanhas.</p>}

      <Panel title={`Campanhas · ${FILTERS[filter]}`} action={<span className="text-sm text-coffee-soft">{live} no ar nesta lista</span>}>
        <nav aria-label="Situação" className="flex flex-wrap gap-1.5">
          {Object.entries(FILTERS).map(([key, label]) => <Link key={key} href={here(key)} className={buttonClass(key === filter ? "primary" : "secondary", "min-h-11 px-3 text-sm")}>{label}</Link>)}
        </nav>
        {campaigns.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma campanha aqui.</p> : (
          <ul className="flex flex-col gap-2" data-testid="campaigns">
            {campaigns.map((item) => {
              const isLive = item.status === "ativa" && item.starts_at <= at && item.ends_at > at;
              const expired = item.ends_at <= at;
              return (
                <li key={item.id} className="flex flex-col gap-2 rounded-2xl bg-cream p-3 text-sm" data-testid="campaign">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p><strong className="text-base">{item.title}</strong> · <Link href={`/admin/lojas/${item.store_id}`} className="underline">{item.store_name}</Link></p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isLive ? "bg-success text-white" : "bg-white"}`}>
                      {isLive ? "No ar" : expired && item.status !== "encerrada" ? "Vencida" : item.status === "ativa" ? "Agendada" : AD_STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="text-coffee-soft">
                    {PLACEMENT_LABELS[item.placement]}{item.category && ` (${item.category})`} · prioridade {item.priority} · {formatDateTime(item.starts_at)} → {formatDateTime(item.ends_at)}
                    · {formatCents(item.price_cents)} · por {item.created_by ?? "—"}
                  </p>
                  <p>
                    {item.impressions.toLocaleString("pt-BR")} impressões · {item.clicks.toLocaleString("pt-BR")} cliques ({ctr(item.clicks, item.impressions)})
                    · {item.orders} pedido{item.orders === 1 ? "" : "s"} atribuído{item.orders === 1 ? "" : "s"} · {formatCents(item.sales_cents)} em vendas
                  </p>
                  {item.notes && <p className="text-coffee-soft">{item.notes}</p>}
                  {superAdmin && item.status !== "encerrada" && !expired && (
                    <ActionForm action={setCampaignStatus} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={item.id} />
                      {item.status === "ativa" && <SubmitButton variant="secondary" name="status" value="pausada" className="min-h-11 px-3 text-xs">Pausar</SubmitButton>}
                      {item.status === "pausada" && <SubmitButton variant="secondary" name="status" value="ativa" className="min-h-11 px-3 text-xs">Retomar</SubmitButton>}
                      <SubmitButton variant="secondary" name="status" value="encerrada" className="min-h-11 px-3 text-xs">Encerrar</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
