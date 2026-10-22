import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Kpi, KpiGrid, Panel } from "@/components/admin/Kpi";
import { Pagination } from "@/components/admin/Pagination";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Bars } from "@/components/ui/Stats";
import { isSuperAdmin, requireRole } from "@/lib/auth/session";
import { pageNumber } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { addDays } from "@/lib/fees/rules";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { fromLocal } from "@/lib/time";
import { correctRating, dismissReport, moderateReview } from "./actions";

export const metadata: Metadata = { title: "Avaliações" };

type SearchParams = Promise<Record<string, string | undefined>>;
const SITUATIONS = { visiveis: "Visíveis", ocultas: "Ocultas", denunciadas: "Denúncias em aberto", suspeitas: "Suspeitas" } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 25;
const stars = (value: number | string | null) => (value === null ? "—" : `${Number(value).toFixed(1).replace(".", ",")} estrelas`);

// Suspeita (só sinaliza, nunca oculta sozinha): telefone ou link no comentário, o mesmo cliente
// avaliando a mesma loja 3+ vezes em 30 dias, ou 5+ avaliações do mesmo cliente em 24 horas.
const SUSPICIOUS = sql`(
  coalesce(r.comment, '') ~* '(https?://|www\\.|[0-9]{8,})'
  or (select count(*) from reviews x where x.customer_id = r.customer_id and x.store_id = r.store_id and x.created_at > r.created_at - interval '30 days' and x.created_at <= r.created_at) >= 3
  or (select count(*) from reviews x where x.customer_id = r.customer_id and x.created_at > r.created_at - interval '24 hours' and x.created_at <= r.created_at) >= 5
)`;

export default function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Reviews searchParams={searchParams} />
    </Suspense>
  );
}

type Row = {
  id: string; rating: number; comment: string | null; reply: string | null; store_id: string; store_name: string; customer: string; code: string; created_at: Date;
  reported_at: Date | null; report_reason: string | null; report_resolved_at: Date | null; hidden_at: Date | null; hidden_reason: string | null; suspicious: boolean;
  events: { action: string; old_rating: number | null; new_rating: number | null; reason: string; actor: string | null; created_at: string }[]; total: number;
};

const EVENT_LABELS: Record<string, string> = { ocultada: "Ocultada", restaurada: "Restaurada", nota_corrigida: "Nota corrigida", denuncia_analisada: "Denúncia analisada e mantida" };

async function Reviews({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole("admin");
  const superAdmin = await isSuperAdmin(profile.id);
  const params = await searchParams;
  const storeId = params.loja && /^[0-9a-f-]{36}$/i.test(params.loja) ? params.loja : null;
  const rating = params.nota && /^[1-5]$/.test(params.nota) ? Number(params.nota) : null;
  const situation = params.situacao && params.situacao in SITUATIONS ? (params.situacao as keyof typeof SITUATIONS) : null;
  const from = params.de && DATE.test(params.de) ? params.de : null;
  const to = params.ate && DATE.test(params.ate) ? params.ate : null;
  const page = pageNumber(params.pagina);

  const where = sql`
    true
    ${storeId ? sql`and r.store_id = ${storeId}` : sql``}
    ${rating ? sql`and r.rating = ${rating}` : sql``}
    ${from ? sql`and r.created_at >= ${fromLocal(from, 0)}` : sql``}
    ${to ? sql`and r.created_at < ${fromLocal(addDays(to, 1), 0)}` : sql``}
    ${situation === "visiveis" ? sql`and r.hidden_at is null` : situation === "ocultas" ? sql`and r.hidden_at is not null`
      : situation === "denunciadas" ? sql`and r.reported_at is not null and r.report_resolved_at is null and r.hidden_at is null`
      : situation === "suspeitas" ? sql`and ${SUSPICIOUS}` : sql``}`;

  const [[summary], distribution, rows, stores, storeTable] = await Promise.all([
    sql<{ avg: string | null; total: number; hidden: number; reported: number; suspicious: number }[]>`
      select round(avg(r.rating) filter (where r.hidden_at is null), 2) as avg, count(*) filter (where r.hidden_at is null)::int as total,
             count(*) filter (where r.hidden_at is not null)::int as hidden,
             count(*) filter (where r.reported_at is not null and r.report_resolved_at is null and r.hidden_at is null)::int as reported,
             count(*) filter (where r.hidden_at is null and ${SUSPICIOUS})::int as suspicious
      from reviews r where ${storeId ? sql`r.store_id = ${storeId}` : sql`true`}`,
    sql<{ rating: number; total: number }[]>`
      select r.rating, count(*)::int as total from reviews r where r.hidden_at is null ${storeId ? sql`and r.store_id = ${storeId}` : sql``} group by 1 order by 1 desc`,
    sql<Row[]>`
      select r.id, r.rating, r.comment, r.reply, r.store_id, s.name as store_name, p.full_name as customer, o.code, r.created_at,
             r.reported_at, r.report_reason, r.report_resolved_at, r.hidden_at, r.hidden_reason, ${SUSPICIOUS} as suspicious,
             coalesce((select json_agg(json_build_object('action', e.action, 'old_rating', e.old_rating, 'new_rating', e.new_rating, 'reason', e.reason,
                 'actor', a.full_name, 'created_at', e.created_at) order by e.created_at desc)
               from review_events e left join profiles a on a.id = e.actor_id where e.review_id = r.id), '[]') as events,
             count(*) over ()::int as total
      from reviews r join stores s on s.id = r.store_id join profiles p on p.id = r.customer_id join orders o on o.id = r.order_id
      where ${where} order by r.created_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
    sql<{ id: string; name: string }[]>`select id, name from stores where status <> 'pending' order by name`,
    sql<{ id: string; name: string; rating_avg: string | null; rating_count: number; one: number; two: number; three: number; four: number; five: number }[]>`
    select s.id, s.name, s.rating_avg, s.rating_count,
           count(*) filter (where r.rating = 1)::int as one, count(*) filter (where r.rating = 2)::int as two, count(*) filter (where r.rating = 3)::int as three,
           count(*) filter (where r.rating = 4)::int as four, count(*) filter (where r.rating = 5)::int as five
    from stores s join reviews r on r.store_id = s.id and r.hidden_at is null
    group by s.id order by s.rating_count desc, s.name limit 50`,
  ]);
  const total = rows[0]?.total ?? 0;
  const keep = { loja: storeId ?? undefined, nota: rating ? String(rating) : undefined, situacao: situation ?? undefined, de: from ?? undefined, ate: to ?? undefined };
  const here = (extra: Record<string, string | undefined>) => withQuery("/admin/avaliacoes", { ...keep, pagina: undefined, ...extra });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Avaliações</h1>
      <p className="text-coffee-soft">
        A nota de cada loja é a média das avaliações visíveis dos últimos 180 dias, calculada sozinha. Não há como mudar a nota de uma loja:
        só ocultar o que viola as regras (com motivo) ou corrigir um erro técnico comprovado, e tudo fica no histórico. Anúncio não mexe na nota.
      </p>

      <KpiGrid>
        <Kpi label="Nota média" value={stars(summary.avg)} hint={storeId ? "Desta loja, todas as avaliações visíveis" : "Todas as avaliações visíveis"} />
        <Kpi label="Avaliações visíveis" value={summary.total} href={here({ situacao: "visiveis" })} />
        <Kpi label="Ocultas" value={summary.hidden} href={here({ situacao: "ocultas" })} />
        <Kpi label="Denúncias em aberto" value={summary.reported} href={here({ situacao: "denunciadas" })} testId="kpi-reported" />
        <Kpi label="Suspeitas" value={summary.suspicious} href={here({ situacao: "suspeitas" })} hint="Link ou telefone no texto, ou avaliações em série" />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Distribuição das estrelas">
          {distribution.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma avaliação.</p>
            : <Bars rows={[5, 4, 3, 2, 1].map((star) => ({ label: `${star} estrela${star > 1 ? "s" : ""}`, value: distribution.find((row) => row.rating === star)?.total ?? 0, href: here({ nota: String(star) }) }))}
                format={(value) => `${value} avaliação${value === 1 ? "" : "ões"}`} />}
        </Panel>
        <Panel title="Por loja">
          <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Notas por loja">
            <table className="w-full text-sm" data-testid="ratings-by-store">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Loja</th><th className="pr-2">Nota (180 dias)</th><th className="text-right">5★ / 4★ / 3★ / 2★ / 1★</th></tr></thead>
              <tbody>
                {storeTable.map((row) => (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="py-1 pr-2"><Link href={here({ loja: row.id })} className="underline">{row.name}</Link></td>
                    <td className="pr-2">{stars(row.rating_avg)} <span className="text-coffee-soft">({row.rating_count})</span></td>
                    <td className="text-right tabular-nums">{row.five} / {row.four} / {row.three} / {row.two} / {row.one}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs font-semibold lg:col-span-2">Loja
          <select name="loja" defaultValue={storeId ?? ""} className={inputClass}><option value="">Todas</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Nota
          <select name="nota" defaultValue={rating ?? ""} className={inputClass}><option value="">Todas</option>{[5, 4, 3, 2, 1].map((star) => <option key={star} value={star}>{star} estrela{star > 1 ? "s" : ""}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Situação
          <select name="situacao" defaultValue={situation ?? ""} className={inputClass}><option value="">Todas</option>{Object.entries(SITUATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">De<input type="date" name="de" defaultValue={from ?? ""} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Até<input type="date" name="ate" defaultValue={to ?? ""} className={inputClass} /></label>
        <button type="submit" className={buttonClass("primary", "min-h-11 lg:col-span-6 lg:justify-self-start")}>Filtrar</button>
      </form>

      <Panel title="Avaliações">
        <p className="text-sm text-coffee-soft" data-testid="list-summary">{total} avaliação{total === 1 ? "" : "ões"}</p>
        {rows.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma avaliação com esses filtros.</p> : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const openReport = row.reported_at && !row.report_resolved_at && !row.hidden_at;
              return (
                <li key={row.id} className={`flex flex-col gap-2 rounded-2xl p-3 text-sm ${row.hidden_at ? "bg-cream opacity-80" : "bg-cream"}`} data-testid="admin-review">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p><strong className="text-brand-dark" aria-label={`${row.rating} de 5 estrelas`}>{"★".repeat(row.rating)}<span className="text-peach">{"★".repeat(5 - row.rating)}</span></strong>
                      {" "}· <Link href={`/admin/lojas/${row.store_id}`} className="underline">{row.store_name}</Link> · {row.customer} · pedido {row.code}</p>
                    <span className="text-xs text-coffee-soft">{formatDateTime(row.created_at)}</span>
                  </div>
                  {row.comment && <p>{row.comment}</p>}
                  {row.reply && <p className="rounded-xl bg-white px-3 py-2"><strong>Resposta da loja:</strong> {row.reply}</p>}
                  <p className="flex flex-wrap gap-1.5 text-xs font-bold">
                    {row.hidden_at && <span className="rounded-full bg-coffee px-2.5 py-1 text-peach">Oculta: {row.hidden_reason}</span>}
                    {openReport && <span className="rounded-full bg-danger px-2.5 py-1 text-white">Denunciada pela loja{row.report_reason ? `: ${row.report_reason}` : ""}</span>}
                    {row.suspicious && !row.hidden_at && <span className="rounded-full bg-brand px-2.5 py-1 text-coffee">Suspeita</span>}
                  </p>
                  {superAdmin && (
                    <div className="flex flex-wrap gap-2">
                      <Modal trigger={row.hidden_at ? "Restaurar" : "Ocultar"} title={row.hidden_at ? "Restaurar avaliação" : "Ocultar avaliação"}>
                        <ActionForm action={moderateReview} className="flex flex-col gap-3">
                          <input type="hidden" name="id" value={row.id} /><input type="hidden" name="action" value={row.hidden_at ? "restaurar" : "ocultar"} />
                          <Field label="Motivo" name="reason" required maxLength={500} placeholder={row.hidden_at ? "Ex.: ocultada por engano" : "Ex.: ofensa pessoal, viola as regras"} />
                          <SubmitButton className="self-start">{row.hidden_at ? "Restaurar" : "Ocultar"}</SubmitButton>
                        </ActionForm>
                      </Modal>
                      {openReport && (
                        <Modal trigger="Manter (denúncia sem fundamento)" title="Analisar denúncia">
                          <ActionForm action={dismissReport} className="flex flex-col gap-3">
                            <input type="hidden" name="id" value={row.id} />
                            <Field label="Motivo da decisão" name="reason" required maxLength={500} />
                            <SubmitButton className="self-start">Manter avaliação</SubmitButton>
                          </ActionForm>
                        </Modal>
                      )}
                      <Modal trigger="Corrigir erro técnico" title="Corrigir erro técnico na nota">
                        <p className="text-sm text-coffee-soft">Só para erro técnico comprovado (a nota gravada não é a que o cliente deu). Nota atual: {row.rating}.</p>
                        <ActionForm action={correctRating} className="flex flex-col gap-3">
                          <input type="hidden" name="id" value={row.id} />
                          <label className="flex flex-col gap-1.5 text-sm font-semibold">Nota correta
                            <select name="rating" defaultValue={row.rating} className={inputClass}>{[5, 4, 3, 2, 1].map((star) => <option key={star} value={star}>{star}</option>)}</select>
                          </label>
                          <Field label="Motivo e comprovação" name="reason" required maxLength={500} />
                          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" name="confirm" className="size-5 accent-brand-dark" /> É a correção de um erro técnico comprovado</label>
                          <SubmitButton className="self-start">Corrigir nota</SubmitButton>
                        </ActionForm>
                      </Modal>
                    </div>
                  )}
                  {row.events.length > 0 && (
                    <details>
                      <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold">Histórico ({row.events.length})</summary>
                      <ul className="flex flex-col gap-1 text-xs" data-testid="review-history">
                        {row.events.map((event, index) => (
                          <li key={index}>{EVENT_LABELS[event.action] ?? event.action}{event.old_rating !== null && ` (${event.old_rating} → ${event.new_rating})`} · {event.actor ?? "—"} · {formatDateTime(new Date(event.created_at))} · {event.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} total={total} size={PAGE} href={(target) => here({ pagina: String(target) })} />
      </Panel>
    </div>
  );
}
