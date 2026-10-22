import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/admin/Pagination";
import { RangeFilter } from "@/components/admin/RangeFilter";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { adminContext, pageNumber } from "@/lib/admin/page";
import { withQuery } from "@/lib/admin/period";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { actionLabel, moduleLabel, redactSecrets } from "@/lib/merchant/audit-log";

export const metadata: Metadata = { title: "Auditoria" };

type SearchParams = Promise<Record<string, string | undefined>>;
const RESULTS = { ok: "Concluída", negado: "Negada", erro: "Com erro" } as const;
const PAGE = 50;

export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

type Row = {
  id: string; actor: string | null; actor_role: string | null; action: string; module: string | null; result: keyof typeof RESULTS; entity_type: string; entity_id: string | null;
  store_id: string | null; store: string | null; reason: string | null; process: string | null; details: Record<string, unknown>; created_at: Date; total: number;
};

async function Audit({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { profile, cities, cityId, range } = await adminContext(params);
  const action = (params.acao ?? "").trim().slice(0, 60);
  const who = (params.quem ?? "").trim().slice(0, 60);
  const entity = (params.registro ?? "").trim().slice(0, 60);
  const area = (params.area ?? "").trim().slice(0, 40);
  const result = params.resultado && params.resultado in RESULTS ? (params.resultado as keyof typeof RESULTS) : null;
  const page = pageNumber(params.pagina);
  // "Hoje", "esta semana", "este mês" e "este ano" vão até o registro mais novo.
  const upper = ["hoje", "semana", "mes", "ano"].includes(range.key) ? new Date(Date.UTC(2100, 0, 1)) : range.to;
  const escape = (text: string) => text.replace(/[\\%_]/g, "\\$&");

  // Lido como admin pelas regras de acesso por linha (RLS): só o admin lê esta tabela inteira.
  const { rows, modules } = await withUser(profile.id, async (tx) => ({
    rows: await tx<Row[]>`
      select l.id, p.full_name as actor, l.actor_role, l.action, l.module, l.result, l.entity_type, l.entity_id::text, l.store_id, s.name as store,
             l.reason, l.process, l.details, l.created_at, count(*) over ()::int as total
      from audit_logs l left join profiles p on p.id = l.actor_id left join stores s on s.id = l.store_id
      where l.created_at >= ${range.from} and l.created_at < ${upper}
        ${action ? tx`and l.action ilike ${`%${escape(action)}%`}` : tx``}
        ${area ? tx`and l.module = ${area}` : tx``}
        ${result ? tx`and l.result = ${result}` : tx``}
        ${entity ? tx`and (l.entity_id::text ilike ${`%${escape(entity)}%`} or l.details->>'code' ilike ${`%${escape(entity)}%`} or s.name ilike ${`%${escape(entity)}%`})` : tx``}
        ${who ? tx`and unaccent(coalesce(p.full_name, '')) ilike unaccent(${`%${escape(who)}%`})` : tx``}
        ${cityId ? tx`and (s.city_id = ${cityId} or l.store_id is null)` : tx``}
      order by l.created_at desc, l.id desc limit ${PAGE} offset ${(page - 1) * PAGE}`,
    modules: await tx<{ module: string }[]>`select distinct module from audit_logs where module is not null order by module`,
  }));
  const total = rows[0]?.total ?? 0;
  const keep = { acao: action || undefined, quem: who || undefined, registro: entity || undefined, area: area || undefined, resultado: result ?? undefined };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Auditoria</h1>
      <p className="text-coffee-soft">Quem fez o quê, quando, em qual conta, com que motivo e resultado. Os registros não podem ser alterados nem apagados; senhas e códigos nunca aparecem.</p>
      <RangeFilter path="/admin/auditoria" range={range} cities={cities} cityId={cityId} keep={keep} />
      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-2 lg:grid-cols-5" role="search">
        {Object.entries(range.query).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <label className="flex flex-col gap-1 text-xs font-semibold">Quem fez<input type="search" name="quem" defaultValue={who} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Área
          <select name="area" defaultValue={area} className={inputClass}><option value="">Todas</option>{modules.map((row) => <option key={row.module} value={row.module}>{moduleLabel(row.module)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Ação<input type="search" name="acao" defaultValue={action} placeholder="Ex.: loja.suspensa" className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Conta, loja ou registro<input type="search" name="registro" defaultValue={entity} placeholder="Nome, código ou id" className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Resultado
          <select name="resultado" defaultValue={result ?? ""} className={inputClass}><option value="">Todos</option>{Object.entries(RESULTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
        <button type="submit" className={buttonClass("primary", "min-h-11 lg:col-span-5 lg:justify-self-start")}>Filtrar</button>
      </form>
      <p className="text-sm text-coffee-soft" data-testid="list-summary">{total} registro{total === 1 ? "" : "s"}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((log) => {
          const details = redactSecrets(log.details ?? {}) as Record<string, unknown>;
          return (
            <li key={log.id} data-testid="audit-row" className="rounded-card bg-white text-sm ring-1 ring-peach">
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 p-3">
                  <strong>{actionLabel(log.action)}</strong>
                  {log.result !== "ok" && <span className="rounded-full bg-danger/10 px-2 text-xs font-bold text-danger">{RESULTS[log.result]}</span>}
                  <span className="text-coffee-soft">· {log.actor ?? log.process ?? "Sistema"}{log.actor_role ? ` (${log.actor_role})` : ""}</span>
                  {log.store && <span className="text-coffee-soft">· {log.store}</span>}
                  <span className="ml-auto text-xs text-coffee-soft">{formatDateTime(log.created_at)}</span>
                </summary>
                <dl className="grid gap-x-3 gap-y-1 border-t border-cream p-3 text-xs sm:grid-cols-[10rem_1fr]">
                  <dt className="font-semibold">Ação</dt><dd className="break-all">{log.action}</dd>
                  <dt className="font-semibold">Área</dt><dd>{moduleLabel(log.module)}</dd>
                  <dt className="font-semibold">Registro afetado</dt>
                  <dd className="break-all">{log.entity_type}{log.entity_id ? ` · ${log.entity_id}` : ""}
                    {log.entity_type === "store" && log.entity_id && <> · <Link href={`/admin/lojas/${log.entity_id}`} className="underline">abrir loja</Link></>}
                    {log.entity_type === "order" && log.entity_id && <> · <Link href={`/admin/pedidos/${log.entity_id}`} className="underline">abrir pedido</Link></>}
                  </dd>
                  {log.reason && <><dt className="font-semibold">Motivo</dt><dd>{log.reason}</dd></>}
                  {log.process && <><dt className="font-semibold">Processo</dt><dd>{log.process}</dd></>}
                  {Object.keys(details).length > 0 && <><dt className="font-semibold">Detalhes (antes e depois)</dt><dd><pre className="whitespace-pre-wrap break-words font-sans">{JSON.stringify(details, null, 2)}</pre></dd></>}
                </dl>
              </details>
            </li>
          );
        })}
        {rows.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nada registrado com esses filtros.</li>}
      </ul>
      <Pagination page={page} total={total} size={PAGE} href={(target) => withQuery("/admin/auditoria", { ...range.query, cidade: cityId, ...keep, pagina: String(target) })} />
    </div>
  );
}
