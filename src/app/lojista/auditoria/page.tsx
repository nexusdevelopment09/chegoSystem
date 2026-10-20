import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/ui/Field";
import { formatDateTime } from "@/lib/format";
import { addDays } from "@/lib/fees/rules";
import { STORE_ROLE_LABELS } from "@/lib/labels";
import {
  actionLabel, auditActors, auditModules, AUDIT_RESULTS, listStoreAudit, moduleLabel, type AuditResult,
} from "@/lib/merchant/audit-log";
import { getMerchantContext } from "@/lib/merchant/context";
import { fromLocal } from "@/lib/time";

export const metadata: Metadata = { title: "Auditoria" };

type SearchParams = Promise<{ quem?: string; modulo?: string; resultado?: string; busca?: string; de?: string; ate?: string; pagina?: string }>;
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const ROLE_LABELS: Record<string, string> = { ...STORE_ROLE_LABELS, staff: "Equipe da loja", customer: "Cliente", admin: "Chegô", system: "Sistema", merchant: "Lojista" };

export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

async function Audit({ searchParams }: { searchParams: SearchParams }) {
  const [params, { store }] = await Promise.all([searchParams, getMerchantContext("auditoria.ver")]);
  const [actors, modules] = await Promise.all([auditActors(store.id), auditModules(store.id)]);
  const actorId = params.quem && UUID.test(params.quem) && actors.some((actor) => actor.id === params.quem) ? params.quem : undefined;
  const area = params.modulo && modules.includes(params.modulo) ? params.modulo : undefined;
  const result = params.resultado && params.resultado in AUDIT_RESULTS ? (params.resultado as AuditResult) : undefined;
  const search = (params.busca ?? "").trim().slice(0, 60);
  const from = params.de && DATE.test(params.de) ? params.de : undefined;
  const to = params.ate && DATE.test(params.ate) ? params.ate : undefined;
  const page = Math.max(1, Number(params.pagina) || 1);

  const { total, rows } = await listStoreAudit(store.id, {
    actorId, module: area, result, search: search || undefined,
    from: from ? fromLocal(from, 0) : undefined, to: to ? fromLocal(addDays(to, 1), 0) : undefined,
    limit: PAGE, offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const kept = { ...(actorId ? { quem: actorId } : {}), ...(area ? { modulo: area } : {}), ...(result ? { resultado: result } : {}), ...(search ? { busca: search } : {}), ...(from ? { de: from } : {}), ...(to ? { ate: to } : {}) };
  const link = (target: number) => `?${new URLSearchParams({ ...kept, pagina: String(target) })}`;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Auditoria</h1>
        <p className="text-coffee-soft">Quem fez o quê na loja, quando e com que resultado. Os registros não podem ser alterados nem apagados, e senhas e códigos nunca aparecem aqui.</p>
      </header>

      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto]" role="search">
        <label className="flex flex-col gap-1 text-xs font-semibold">Quem fez
          <select name="quem" defaultValue={actorId ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}{actor.active ? "" : " (saiu)"}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Área
          <select name="modulo" defaultValue={area ?? ""} className={inputClass}>
            <option value="">Todas</option>
            {modules.map((item) => <option key={item} value={item}>{moduleLabel(item)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Resultado
          <select name="resultado" defaultValue={result ?? ""} className={inputClass}>
            <option value="">Todos</option>
            {Object.entries(AUDIT_RESULTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Pedido ou registro<input type="search" name="busca" defaultValue={search} placeholder="Ex.: CH-1234" className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">De<input type="date" name="de" defaultValue={from ?? ""} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Até<input type="date" name="ate" defaultValue={to ?? ""} className={inputClass} /></label>
        <button className="min-h-11 self-end rounded-full bg-brand-dark px-5 text-sm font-bold text-white">Filtrar</button>
      </form>

      {total === 0 ? (
        <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nada registrado com esses filtros.</p>
      ) : (
        <section className="flex flex-col gap-2">
          <p className="text-sm text-coffee-soft">{total} registro{total === 1 ? "" : "s"}</p>
          <ul className="flex flex-col gap-2" data-testid="store-audit">
            {rows.map((row) => (
              <li key={row.id} data-testid="audit-row" className="rounded-card bg-white text-sm ring-1 ring-peach">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 p-3">
                    <strong>{actionLabel(row.action)}</strong>
                    {row.result !== "ok" && <span className="rounded-full bg-danger/10 px-2 text-xs font-bold text-danger">{AUDIT_RESULTS[row.result]}</span>}
                    <span className="text-coffee-soft">· {row.actorName ?? row.process ?? "Sistema"}{row.actorRole ? ` (${ROLE_LABELS[row.actorRole] ?? row.actorRole})` : ""}</span>
                    {typeof row.details.code === "string" && <span className="text-coffee-soft">· pedido {row.details.code}</span>}
                    <span className="ml-auto text-xs text-coffee-soft">{formatDateTime(row.createdAt)}</span>
                  </summary>
                  <dl className="grid gap-x-3 gap-y-1 border-t border-cream p-3 text-xs sm:grid-cols-[10rem_1fr]">
                    <dt className="font-semibold">Área</dt><dd>{moduleLabel(row.module)}</dd>
                    <dt className="font-semibold">Ação</dt><dd className="break-all">{row.action}</dd>
                    <dt className="font-semibold">Registro</dt>
                    <dd className="break-all">
                      {row.entityType}{row.entityId ? ` · ${row.entityId}` : ""}
                      {row.entityType === "order" && row.entityId && <> · <Link href={`/lojista/pedidos/${row.entityId}`} className="underline">abrir pedido</Link></>}
                    </dd>
                    {row.reason && <><dt className="font-semibold">Motivo</dt><dd>{row.reason}</dd></>}
                    {row.process && <><dt className="font-semibold">Processo</dt><dd>{row.process}</dd></>}
                    {Object.keys(row.details).length > 0 && (
                      <><dt className="font-semibold">Detalhes</dt><dd><pre className="whitespace-pre-wrap break-words font-sans">{JSON.stringify(row.details, null, 2)}</pre></dd></>
                    )}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label="Páginas" className="flex items-center gap-2 text-sm">
              {page > 1 && <Link href={link(page - 1)} className="flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach">← Anterior</Link>}
              <span>Página {page} de {pages}</span>
              {page < pages && <Link href={link(page + 1)} className="flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach">Próxima →</Link>}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
