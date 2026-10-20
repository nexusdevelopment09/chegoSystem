import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { businessDate } from "@/lib/fees/rules";
import { formatDateTime } from "@/lib/format";
import { listAlerts } from "@/lib/inventory/queries";
import { LEVEL_LABELS, stockLevel } from "@/lib/inventory/rules";
import { refreshExpiryAlerts } from "@/lib/inventory/stock";
import { getMerchantContext } from "@/lib/merchant/context";
import { resolveAlert } from "../actions";
import { Empty, qty, StockNav } from "../StockParts";

export const metadata: Metadata = { title: "Alertas do estoque" };

const KIND = { baixo: "Estoque baixo", vencendo: "Vence logo", vencido: "Vencido", conferir: "Conferir inventário" } as const;

export default function AlertsPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Alerts searchParams={searchParams} />
    </Suspense>
  );
}

async function Alerts({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const [{ ver }, { membership, store, at }] = await Promise.all([searchParams, getMerchantContext("estoque.ver")]);
  await refreshExpiryAlerts(sql, store.id, businessDate(at, 0));
  const resolved = ver === "resolvidos";
  const alerts = await listAlerts(store.id, resolved);
  const low = alerts.filter((alert) => alert.kind === "baixo");
  const others = alerts.filter((alert) => alert.kind !== "baixo");

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Alertas do estoque</h1>
        <p className="text-coffee-soft">Um alerta por item e motivo: abre quando o item passa do limite e se resolve sozinho quando volta ao normal.</p>
      </header>
      <StockNav current="/lojista/estoque/alertas" counts={{ alerts: resolved ? undefined : alerts.length }} />
      <div className="flex gap-2">
        <Link href="?" aria-current={!resolved ? "true" : undefined} className={`flex min-h-11 items-center rounded-full px-4 text-sm font-bold ring-1 ${!resolved ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach"}`}>Ativos</Link>
        <Link href="?ver=resolvidos" aria-current={resolved ? "true" : undefined} className={`flex min-h-11 items-center rounded-full px-4 text-sm font-bold ring-1 ${resolved ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach"}`}>Resolvidos</Link>
      </div>

      {alerts.length === 0 && <Empty>{resolved ? "Nenhum alerta resolvido ainda." : "Nenhum alerta ativo. Tudo dentro dos limites cadastrados."}</Empty>}

      {low.length > 0 && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Estoque baixo</h2>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Itens com estoque baixo">
            <table className="w-full min-w-[600px] text-sm" data-testid="low-stock">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Item</th><th className="pr-2 text-right">Atual</th><th className="pr-2 text-right">Mínimo</th><th className="pr-2 text-right">Falta para o mínimo</th><th className="pr-2 text-right">Ideal</th><th className="pr-2">Situação</th><th /></tr></thead>
              <tbody>
                {low.map((alert) => (
                  <tr key={alert.id} className="border-t border-cream">
                    <td className="py-2 pr-2 font-semibold">{alert.itemName}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(alert.quantity, alert.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(alert.minQuantity, alert.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(Math.max(0, alert.minQuantity - alert.quantity), alert.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{alert.idealQuantity !== null ? qty(alert.idealQuantity, alert.unit) : "—"}</td>
                    <td className="pr-2">{resolved ? `Resolvido em ${formatDateTime(alert.resolvedAt!)}` : LEVEL_LABELS[stockLevel(alert.quantity, alert.minQuantity)]}</td>
                    <td>{!resolved && hasPermission(membership, "estoque.movimentar") && <Link href={`/lojista/estoque/${alert.itemId}`} className="inline-flex min-h-11 items-center font-bold text-brand-dark underline">Registrar compra</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Validade e conferência</h2>
          <ul className="divide-y divide-cream text-sm" data-testid="other-alerts">
            {others.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong className={alert.kind === "vencido" ? "text-danger" : ""}>{KIND[alert.kind]}</strong> · <Link href={`/lojista/estoque/${alert.itemId}`} className="underline">{alert.itemName}</Link>
                  {alert.detail && <span className="block text-coffee-soft">{alert.detail}</span>}
                  <span className="block text-xs text-coffee-soft">{resolved ? `Resolvido em ${formatDateTime(alert.resolvedAt!)}` : `Desde ${formatDateTime(alert.openedAt)}`}</span>
                </span>
                {!resolved && alert.kind === "conferir" && hasPermission(membership, "estoque.movimentar") && (
                  <form action={resolveAlert}><input type="hidden" name="id" value={alert.id} /><Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">Conferido</Button></form>
                )}
                {!resolved && (alert.kind === "vencido" || alert.kind === "vencendo") && <Link href="/lojista/estoque/validade" className="inline-flex min-h-11 items-center font-bold text-brand-dark underline">Ver validade</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
