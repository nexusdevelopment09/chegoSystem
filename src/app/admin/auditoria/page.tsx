import type { Metadata } from "next";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Log de auditoria" };

type SearchParams = Promise<{ acao?: string; quem?: string }>;

export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

async function Audit({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole("admin");
  const { acao, quem } = await searchParams;
  const action = (acao ?? "").trim().slice(0, 40);
  const who = (quem ?? "").trim().slice(0, 60);

  // Read as the admin through Row Level Security: nobody else can read this table at all.
  const { logs, actions } = await withUser(profile.id, async (tx) => ({
    logs: await tx<{ id: string; actor: string | null; action: string; entity_type: string; entity_id: string | null; store: string | null; details: Record<string, unknown>; created_at: Date }[]>`
      select l.id, p.full_name as actor, l.action, l.entity_type, l.entity_id, s.name as store, l.details, l.created_at
      from audit_logs l left join profiles p on p.id = l.actor_id left join stores s on s.id = l.store_id
      where true
        ${action ? tx`and l.action like ${`${action.replace(/[\\%_]/g, "\\$&")}%`}` : tx``}
        ${who ? tx`and unaccent(coalesce(p.full_name, '')) ilike unaccent(${`%${who.replace(/[\\%_]/g, "\\$&")}%`})` : tx``}
      order by l.created_at desc limit 200`,
    actions: await tx<{ action: string }[]>`select distinct action from audit_logs order by action`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Log de auditoria</h1>
      <p className="text-coffee-soft">Quem fez o quê e quando: comissão, destaque, plano, reembolso, bloqueio, suspensão e outras ações sensíveis.</p>
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" role="search">
        <select name="acao" defaultValue={action} aria-label="Ação" className={inputClass}>
          <option value="">Todas as ações</option>
          {actions.map((row) => <option key={row.action} value={row.action}>{row.action}</option>)}
        </select>
        <input type="search" name="quem" defaultValue={who} placeholder="Quem fez" aria-label="Quem fez" className={inputClass} />
        <button type="submit" className={buttonClass("secondary")}>Filtrar</button>
      </form>

      <ul className="flex flex-col gap-2">
        {logs.map((log) => (
          <li key={log.id} data-testid="audit-row" className="rounded-card bg-white p-3 text-sm ring-1 ring-peach">
            <p>
              <strong>{log.action}</strong> · {log.actor ?? "Sistema"} · {formatDateTime(log.created_at)}
              {log.store && <span className="text-coffee-soft"> · {log.store}</span>}
            </p>
            {Object.keys(log.details).length > 0 && (
              <p className="break-words text-coffee-soft">
                {Object.entries(log.details).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}
              </p>
            )}
          </li>
        ))}
        {logs.length === 0 && <li className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nada registrado com esses filtros.</li>}
      </ul>
    </div>
  );
}
