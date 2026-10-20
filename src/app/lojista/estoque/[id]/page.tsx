import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { businessDate } from "@/lib/fees/rules";
import { formatCents, formatDateTime } from "@/lib/format";
import { getStockItem, listLots, listMovements, listStockItems, stockSettings } from "@/lib/inventory/queries";
import { daysUntil, expiryStatus, MOVEMENT_LABELS, UNIT_LABELS } from "@/lib/inventory/rules";
import { getMerchantContext } from "@/lib/merchant/context";
import { discardLot, registerMovement } from "../actions";
import { ExpiryBadge, LevelBadge, qty, StockItemForm, StockNav } from "../StockParts";

export const metadata: Metadata = { title: "Item do estoque" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string }> };
const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const PAGE = 30;

export default function StockItemPage(props: Props) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Item {...props} />
    </Suspense>
  );
}

async function Item({ params, searchParams }: Props) {
  const [{ id }, { pagina }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const { membership, store, at } = await getMerchantContext("estoque.ver");
  const item = await getStockItem(store.id, id);
  if (!item) notFound();
  const page = Math.max(1, Number(pagina) || 1);
  const today = businessDate(at, 0);
  const [movements, lots, settings, all, products, recipes] = await Promise.all([
    listMovements(store.id, { itemId: id, limit: PAGE, offset: (page - 1) * PAGE }),
    listLots(store.id, { itemId: id }),
    stockSettings(store.id),
    listStockItems(store.id),
    sql<{ id: string; name: string }[]>`
      select p.id, p.name from products p where p.store_id = ${store.id} and p.deleted_at is null
        and (p.id = ${item.productId} or not exists (select 1 from stock_items i where i.product_id = p.id)) order by p.name`,
    sql<{ product_id: string; product_name: string; option_name: string | null; quantity: string }[]>`
      select r.product_id, p.name as product_name, o.name as option_name, r.quantity::text
      from recipe_lines r join products p on p.id = r.product_id left join options o on o.id = r.option_id
      where r.item_id = ${id} and r.store_id = ${store.id} order by p.name`,
  ]);
  const unit = UNIT_LABELS[item.unit].short;
  const openLots = lots.filter((lot) => lot.remainingQuantity > 0 && !lot.discardedAt);
  const categories = [...new Set(all.map((row) => row.category).filter((value): value is string => Boolean(value)))];
  const pages = Math.max(1, Math.ceil(movements.total / PAGE));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/lojista/estoque" className="inline-flex min-h-11 items-center self-start font-semibold text-brand-dark">← Estoque</Link>
      <StockNav current="/lojista/estoque" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">{item.name}</h1>
          <p className="text-coffee-soft">{[item.category, item.sku, item.supplier, item.storageLocation].filter(Boolean).join(" · ") || "Sem categoria"}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-semibold" data-testid="item-balance">{qty(item.quantity, item.unit)}</p>
          <p className="text-sm text-coffee-soft">mínimo {qty(item.minQuantity, item.unit)}{item.idealQuantity !== null && ` · ideal ${qty(item.idealQuantity, item.unit)}`}</p>
          <LevelBadge level={item.level} />
        </div>
      </header>
      {item.productName && <p className="rounded-2xl bg-peach px-4 py-2 text-sm">Ligado ao produto <strong>{item.productName}</strong>: cada venda baixa daqui e o produto esgota sozinho quando o saldo zera.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {hasPermission(membership, "estoque.movimentar") && (
          <section className={card}>
            <h2 className="text-xl">Entrada (compra ou reposição)</h2>
            <ActionForm action={registerMovement} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="kind" value="compra" />
              <input type="hidden" name="itemId" value={item.id} />
              {item.perishable && <input type="hidden" name="perishable" value="on" />}
              <Field label={`Quantidade (${unit})`} name="quantity" inputMode="decimal" required />
              <Field label="Custo total da compra (R$)" name="cost" inputMode="decimal" hint="Opcional. Atualiza o custo unitário." />
              {item.perishable && (
                <>
                  <Field label="Validade" name="expiresAt" type="date" required />
                  <Field label="Fabricação" name="manufacturedAt" type="date" />
                </>
              )}
              <Field label="Fornecedor" name="supplier" maxLength={120} defaultValue={item.supplier ?? ""} />
              <SubmitButton className="self-end">Registrar entrada</SubmitButton>
            </ActionForm>
          </section>
        )}
        {(hasPermission(membership, "estoque.perdas") || hasPermission(membership, "estoque.ajustar")) && (
          <section className={card}>
            <h2 className="text-xl">Saída ou ajuste</h2>
            <ActionForm action={registerMovement} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="itemId" value={item.id} />
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                Tipo
                <select name="kind" className={inputClass} defaultValue={hasPermission(membership, "estoque.perdas") ? "perda" : "ajuste"}>
                  {hasPermission(membership, "estoque.perdas") && <option value="perda">Perda / desperdício (quantidade que saiu)</option>}
                  {hasPermission(membership, "estoque.perdas") && <option value="vencido">Vencido (quantidade descartada)</option>}
                  {hasPermission(membership, "estoque.ajustar") && <option value="ajuste">Ajuste de inventário (quantidade contada)</option>}
                </select>
              </label>
              <Field label={`Quantidade (${unit})`} name="quantity" inputMode="decimal" required hint="No ajuste, a contagem real; o sistema registra a diferença." />
              {openLots.length > 0 && (
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Lote (opcional)
                  <select name="lotId" className={inputClass} defaultValue="">
                    <option value="">O que vence primeiro</option>
                    {openLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.expiresAt ? `Validade ${lot.expiresAt.split("-").reverse().join("/")}` : `Entrada ${lot.receivedAt.split("-").reverse().join("/")}`} · {qty(lot.remainingQuantity, item.unit)}</option>)}
                  </select>
                </label>
              )}
              <Field label="Motivo" name="reason" required maxLength={300} placeholder="Ex.: caiu no chão; contagem de fim de mês" />
              <SubmitButton variant="secondary" className="self-end">Registrar</SubmitButton>
            </ActionForm>
          </section>
        )}
      </div>

      {(item.perishable || lots.length > 0) && (
        <section className={card}>
          <h2 className="text-xl">Lotes e validade</h2>
          {lots.length === 0 ? <p className="text-sm text-coffee-soft">Nenhum lote ainda. Lotes nascem nas entradas de itens perecíveis.</p> : (
            <ul className="divide-y divide-cream text-sm" data-testid="item-lots">
              {lots.map((lot) => (
                <li key={lot.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{qty(lot.remainingQuantity, item.unit)}</strong> de {qty(lot.receivedQuantity, item.unit)} · entrada {lot.receivedAt.split("-").reverse().join("/")}
                    {lot.expiresAt && <> · validade {lot.expiresAt.split("-").reverse().join("/")}</>}
                    {lot.costCents !== null && <> · {formatCents(lot.costCents)}</>}
                    <span className="ml-2">{lot.discardedAt ? <span className="text-xs font-bold text-coffee-soft">Descartado</span>
                      : <ExpiryBadge status={expiryStatus(lot.expiresAt, today, settings.warningDays)} days={lot.expiresAt ? daysUntil(lot.expiresAt, today) : null} />}</span>
                  </span>
                  {!lot.discardedAt && lot.remainingQuantity > 0 && hasPermission(membership, "estoque.perdas") && (
                    <ActionForm action={discardLot} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="lotId" value={lot.id} />
                      <label className="flex min-h-11 items-center gap-2 text-xs font-semibold"><input type="checkbox" name="confirm" className="size-5 accent-brand-dark" /> Confirmo o descarte</label>
                      <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">Descartar lote</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {recipes.length > 0 && (
        <section className={card}>
          <h2 className="text-xl">Usado nas fichas técnicas</h2>
          <ul className="text-sm">
            {recipes.map((row) => (
              <li key={`${row.product_id}-${row.option_name}`} className="py-1">
                <Link href={`/lojista/cardapio/produto/${row.product_id}`} className="underline">{row.product_name}</Link>
                {row.option_name && <> · {row.option_name}</>}: {qty(Number(row.quantity), item.unit)} por unidade
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="text-xl">Histórico de movimentações</h2>
        {movements.total === 0 ? <p className="text-sm text-coffee-soft">Nenhuma movimentação ainda.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Movimentações do item">
            <table className="w-full min-w-[640px] text-sm" data-testid="item-movements">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Quando</th><th className="pr-2">Tipo</th><th className="pr-2 text-right">Quantidade</th><th className="pr-2 text-right">Saldo depois</th><th>Motivo e responsável</th></tr></thead>
              <tbody>
                {movements.rows.map((row) => (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="py-1 pr-2">{formatDateTime(row.createdAt)}</td>
                    <td className="pr-2">{MOVEMENT_LABELS[row.kind]}</td>
                    <td className={`pr-2 text-right font-semibold tabular-nums ${row.quantity < 0 ? "text-danger" : "text-success"}`}>{row.quantity > 0 ? "+" : ""}{qty(row.quantity, item.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(row.balanceAfter, item.unit)}</td>
                    <td className="text-coffee-soft">
                      {row.reason ?? ""}{row.orderCode && <> pedido <Link href={`/lojista/pedidos/${row.orderId}`} className="underline">{row.orderCode}</Link></>}
                      {" · "}{row.byName ?? row.process ?? "sistema"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Páginas" className="flex items-center gap-2 text-sm">
            {page > 1 && <Link href={`?pagina=${page - 1}`} className="flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach">← Anterior</Link>}
            <span>Página {page} de {pages}</span>
            {page < pages && <Link href={`?pagina=${page + 1}`} className="flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach">Próxima →</Link>}
          </nav>
        )}
      </section>

      {hasPermission(membership, "estoque.ajustar") && (
        <details className="rounded-card bg-white p-4 ring-1 ring-peach">
          <summary className="min-h-11 cursor-pointer content-center text-xl font-semibold">Editar cadastro</summary>
          <StockItemForm item={item} products={products} categories={categories} />
        </details>
      )}
    </div>
  );
}
