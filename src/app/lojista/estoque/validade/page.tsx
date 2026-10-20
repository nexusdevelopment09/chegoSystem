import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { inputClass } from "@/components/ui/Field";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { businessDate } from "@/lib/fees/rules";
import { listAlerts, listLots, stockSettings } from "@/lib/inventory/queries";
import { daysUntil, EXPIRY_LABELS, expiryStatus, type ExpiryStatus } from "@/lib/inventory/rules";
import { refreshExpiryAlerts } from "@/lib/inventory/stock";
import { getMerchantContext } from "@/lib/merchant/context";
import { discardLot } from "../actions";
import { Empty, ExpiryBadge, qty, StockNav } from "../StockParts";

export const metadata: Metadata = { title: "Validade" };

type SearchParams = Promise<{ situacao?: string; q?: string }>;
const ORDER: ExpiryStatus[] = ["vencido", "vence_hoje", "urgente", "atencao", "ok", "sem_validade"];

export default function ExpiryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Expiry searchParams={searchParams} />
    </Suspense>
  );
}

async function Expiry({ searchParams }: { searchParams: SearchParams }) {
  const [params, { membership, store, at }] = await Promise.all([searchParams, getMerchantContext("validade.ver")]);
  const today = businessDate(at, 0);
  await refreshExpiryAlerts(sql, store.id, today);
  const [lots, settings, alerts] = await Promise.all([listLots(store.id, { onlyOpen: true }), stockSettings(store.id), listAlerts(store.id)]);
  const rows = lots
    .map((lot) => ({ lot, status: expiryStatus(lot.expiresAt, today, settings.warningDays), days: lot.expiresAt ? daysUntil(lot.expiresAt, today) : null }))
    .filter((row) => !params.situacao || row.status === params.situacao)
    .filter((row) => !params.q || row.lot.itemName.toLowerCase().includes(params.q.toLowerCase()))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.days ?? 9999) - (b.days ?? 9999));
  const canDiscard = hasPermission(membership, "estoque.perdas");
  const counts = Object.fromEntries(ORDER.map((status) => [status, lots.filter((lot) => expiryStatus(lot.expiresAt, today, settings.warningDays) === status).length]));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Validade</h1>
        <p className="text-coffee-soft">
          Lotes com saldo, do que vence primeiro. Avisos com {settings.warningDays.join(", ")} dias de antecedência (horário de Maceió).
          Lote vencido nunca é usado nas vendas: descarte quando conferir.
        </p>
      </header>
      <StockNav current="/lojista/estoque/validade" counts={{ alerts: alerts.length, expiring: counts.vencido + counts.vence_hoje + counts.urgente + counts.atencao }} />
      <div className="flex flex-wrap gap-2">
        {ORDER.filter((status) => status !== "sem_validade").map((status) => (
          <Link key={status} href={`?situacao=${status}`} aria-current={params.situacao === status ? "true" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 ${params.situacao === status ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach"}`}>
            {EXPIRY_LABELS[status]} <span className="tabular-nums">{counts[status]}</span>
          </Link>
        ))}
        {params.situacao && <Link href="?" className="flex min-h-11 items-center px-2 text-sm font-semibold text-brand-dark underline">Ver todos</Link>}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2">
        {params.situacao && <input type="hidden" name="situacao" value={params.situacao} />}
        <label className="flex flex-col gap-1 text-xs font-semibold">Buscar item<input name="q" defaultValue={params.q ?? ""} className={inputClass} /></label>
        <button className="min-h-11 rounded-full bg-brand-dark px-5 text-sm font-bold text-white">Buscar</button>
      </form>

      {rows.length === 0 ? <Empty>Nenhum lote com saldo{params.situacao ? " nessa situação" : ""}. Lotes nascem nas entradas de itens perecíveis.</Empty> : (
        <ul className="flex flex-col gap-2" data-testid="expiry-lots">
          {rows.map(({ lot, status, days }) => (
            <li key={lot.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-card bg-white p-3 ring-1 ${status === "vencido" || status === "vence_hoje" || status === "urgente" ? "ring-danger" : "ring-peach"}`} data-testid="expiry-lot">
              <div className="min-w-0">
                <Link href={`/lojista/estoque/${lot.itemId}`} className="font-semibold underline">{lot.itemName}</Link>
                <p className="text-sm text-coffee-soft">
                  {qty(lot.remainingQuantity, lot.unit)} restantes de {qty(lot.receivedQuantity, lot.unit)} · validade {lot.expiresAt ? lot.expiresAt.split("-").reverse().join("/") : "—"}
                  {lot.supplier && ` · ${lot.supplier}`}
                </p>
                <ExpiryBadge status={status} days={days} />
              </div>
              {canDiscard && (status === "vencido" || status === "vence_hoje") && (
                <ActionForm action={discardLot} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="lotId" value={lot.id} />
                  <label className="flex min-h-11 items-center gap-2 text-xs font-semibold"><input type="checkbox" name="confirm" className="size-5 accent-brand-dark" /> Conferi e vou descartar</label>
                  <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">Registrar descarte</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
