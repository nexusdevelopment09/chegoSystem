import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { businessDate } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";
import { listAlerts, listStockItems, stockSettings } from "@/lib/inventory/queries";
import { daysUntil, expiryStatus, LEVEL_LABELS, type StockLevel } from "@/lib/inventory/rules";
import { refreshExpiryAlerts } from "@/lib/inventory/stock";
import { getMerchantContext } from "@/lib/merchant/context";
import { saveStockSettings } from "./actions";
import { Empty, ExpiryBadge, LevelBadge, qty, StockItemForm, StockNav } from "./StockParts";

export const metadata: Metadata = { title: "Estoque" };

type SearchParams = Promise<{ q?: string; categoria?: string; situacao?: string; nivel?: string; ordem?: string }>;

export default function StockPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando estoque" />}>
      <Stock searchParams={searchParams} />
    </Suspense>
  );
}

async function Stock({ searchParams }: { searchParams: SearchParams }) {
  const [params, { membership, store, at }] = await Promise.all([searchParams, getMerchantContext("estoque.ver")]);
  const today = businessDate(at, 0);
  await refreshExpiryAlerts(sql, store.id, today);
  const [all, alerts, settings, products] = await Promise.all([
    listStockItems(store.id, { q: params.q, category: params.categoria, status: params.situacao }),
    listAlerts(store.id),
    stockSettings(store.id),
    sql<{ id: string; name: string }[]>`
      select p.id, p.name from products p where p.store_id = ${store.id} and p.deleted_at is null
        and not exists (select 1 from stock_items i where i.product_id = p.id) order by p.name`,
  ]);
  const items = params.nivel ? all.filter((item) => item.level === params.nivel) : all;
  if (params.ordem === "nivel") items.sort((a, b) => ["zerado", "baixo", "repor", "normal"].indexOf(a.level) - ["zerado", "baixo", "repor", "normal"].indexOf(b.level));
  if (params.ordem === "validade") items.sort((a, b) => (a.nextExpiry ?? "9999").localeCompare(b.nextExpiry ?? "9999"));
  const categories = [...new Set(all.map((item) => item.category).filter((value): value is string => Boolean(value)))].sort();
  const canEdit = hasPermission(membership, "estoque.ajustar");
  const expiring = alerts.filter((alert) => alert.kind === "vencendo" || alert.kind === "vencido").length;
  const value = all.reduce((sum, item) => sum + (item.unitCostCents ?? 0) * Math.max(item.quantity, 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl">Estoque</h1>
          <p className="text-coffee-soft">Produtos e insumos da loja. O saldo só muda por movimentações registradas.</p>
        </div>
        {hasPermission(membership, "financeiro.ver") && value > 0 && <p className="text-sm">Valor em estoque (pelo custo): <strong>{formatCents(Math.round(value))}</strong></p>}
      </header>
      <StockNav current="/lojista/estoque" counts={{ alerts: alerts.length, expiring }} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stock-summary">
        {(["zerado", "baixo", "repor", "normal"] as StockLevel[]).map((level) => (
          <Link key={level} href={`/lojista/estoque?nivel=${level}`} className="rounded-card bg-white p-3 ring-1 ring-peach hover:ring-brand">
            <p className="text-sm text-coffee-soft">{LEVEL_LABELS[level]}</p>
            <p className="font-display text-2xl font-semibold">{all.filter((item) => item.level === level).length}</p>
          </Link>
        ))}
      </div>

      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs font-semibold">Buscar<input name="q" defaultValue={params.q ?? ""} placeholder="Nome ou código" className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Categoria
          <select name="categoria" defaultValue={params.categoria ?? ""} className={inputClass}><option value="">Todas</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Situação
          <select name="situacao" defaultValue={params.situacao ?? ""} className={inputClass}><option value="">Todas</option><option value="ativo">Ativo</option><option value="indisponivel">Indisponível</option><option value="inativo">Inativo</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Ordenar
          <select name="ordem" defaultValue={params.ordem ?? ""} className={inputClass}><option value="">Nome</option><option value="nivel">Mais urgente</option><option value="validade">Validade</option></select>
        </label>
        <button className="min-h-11 self-end rounded-full bg-brand-dark px-5 text-sm font-bold text-white">Filtrar</button>
      </form>

      {items.length === 0 ? (
        <Empty>{all.length === 0 ? "Nenhum item no estoque ainda. Cadastre o primeiro abaixo." : "Nenhum item com esses filtros."}</Empty>
      ) : (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Itens do estoque (role para o lado para ver tudo)">
            <table className="w-full min-w-[720px] text-sm" data-testid="stock-items">
              <thead><tr className="text-left text-coffee-soft">
                <th scope="col" className="py-1 pr-2">Item</th><th scope="col" className="pr-2 text-right">Saldo</th><th scope="col" className="pr-2 text-right">Mínimo</th>
                <th scope="col" className="pr-2">Situação</th><th scope="col" className="pr-2">Validade</th><th scope="col">Última movimentação</th>
              </tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-cream" data-testid="stock-item">
                    <td className="py-2 pr-2">
                      <Link href={`/lojista/estoque/${item.id}`} className="font-semibold underline">{item.name}</Link>
                      <span className="block text-xs text-coffee-soft">
                        {[item.category, item.sku, item.productName ? `cardápio: ${item.productName}` : null, item.status !== "ativo" ? item.status : null].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="pr-2 text-right font-semibold tabular-nums">{qty(item.quantity, item.unit)}</td>
                    <td className="pr-2 text-right tabular-nums text-coffee-soft">{qty(item.minQuantity, item.unit)}</td>
                    <td className="pr-2"><LevelBadge level={item.level} /></td>
                    <td className="pr-2">{item.nextExpiry ? <ExpiryBadge status={expiryStatus(item.nextExpiry, today, settings.warningDays)} days={daysUntil(item.nextExpiry, today)} /> : "—"}</td>
                    <td className="text-coffee-soft">{item.lastMovementAt ? formatDateTime(item.lastMovementAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canEdit && (
        <>
          <details className="rounded-card bg-white p-4 ring-1 ring-peach" open={all.length === 0}>
            <summary className="min-h-11 cursor-pointer content-center text-xl font-semibold">Novo item</summary>
            <StockItemForm item={null} products={products} categories={categories} />
          </details>
          <details className="rounded-card bg-white p-4 ring-1 ring-peach">
            <summary className="min-h-11 cursor-pointer content-center text-xl font-semibold">Configurações do estoque</summary>
            <ActionForm action={saveStockSettings} className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Avisos de validade (dias antes)" name="warningDays" defaultValue={settings.warningDays.join(", ")} hint="Ex.: 30, 15, 7, 3. O menor é o aviso urgente." />
              <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
                <input type="checkbox" name="allowNegative" defaultChecked={settings.allowNegative} className="size-5 accent-brand-dark" />
                Permitir saldo negativo de insumos (consumo estimado maior que o estoque)
              </label>
              <SubmitButton className="self-start">Salvar configuração</SubmitButton>
            </ActionForm>
          </details>
        </>
      )}
    </div>
  );
}
