import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { suggestions } from "@/lib/inventory/queries";
import { getMerchantContext } from "@/lib/merchant/context";
import { createPurchaseList } from "../actions";
import { Empty, qty, StockNav } from "../StockParts";

export const metadata: Metadata = { title: "Reposição" };

const TREND = { subindo: "↑ subindo", caindo: "↓ caindo", estavel: "estável", sem_dados: "sem consumo registrado" } as const;
const LIST_STATUS = { rascunho: "Rascunho", aprovada: "Aprovada", recebida: "Recebida", cancelada: "Cancelada" } as const;

export default function RestockPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Calculando sugestões" />}>
      <Restock />
    </Suspense>
  );
}

async function Restock() {
  const { membership, store, at } = await getMerchantContext("reposicao.ver");
  const [items, lists, topSellers] = await Promise.all([
    suggestions(store.id, at),
    sql<{ id: string; status: keyof typeof LIST_STATUS; created_at: Date; items: number; by_name: string }[]>`
      select l.id, l.status, l.created_at, (select count(*)::int from purchase_list_items i where i.list_id = l.id) as items, p.full_name as by_name
      from purchase_lists l join profiles p on p.id = l.created_by where l.store_id = ${store.id} order by l.created_at desc limit 10`,
    // Os mais vendidos dos últimos 7 dias (pedidos que viraram venda), para explicar o consumo.
    sql<{ name: string; quantity: number }[]>`
      select i.name, sum(i.quantity)::int as quantity from order_items i join orders o on o.id = i.order_id
      where o.store_id = ${store.id} and o.paid_at >= ${new Date(at.getTime() - 7 * 86_400_000)}
        and o.status not in ('rejected', 'cancelled', 'refunded', 'expired') and i.removed_at is null
      group by i.name order by quantity desc limit 5`,
  ]);
  const toBuy = items.filter((item) => item.suggested > 0);
  const totalCost = toBuy.reduce((sum, item) => sum + (item.estimatedCostCents ?? 0), 0);
  const withoutRecipe = items.filter((item) => !item.hasRecipe).length;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Reposição</h1>
        <p className="text-coffee-soft">
          Sugestões a partir do que saiu de verdade do estoque nos últimos 30 dias (vendas e consumo pelas fichas técnicas, sem contar cancelados),
          do estoque atual, do mínimo, do ideal e do prazo de cada fornecedor. São estimativas: revise antes de comprar. Nada é comprado sozinho.
        </p>
      </header>
      <StockNav current="/lojista/estoque/reposicao" />

      {topSellers.length > 0 && (
        <p className="rounded-2xl bg-cream px-4 py-3 text-sm" data-testid="top-sellers">
          Mais vendidos nos últimos 7 dias: {topSellers.map((row) => `${row.name} (${row.quantity})`).join(", ")}.
        </p>
      )}
      {withoutRecipe > 0 && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-sm">
          {withoutRecipe} {withoutRecipe === 1 ? "item não aparece" : "itens não aparecem"} em nenhuma ficha técnica nem estão ligados a um produto: para eles a sugestão é limitada
          (só o mínimo e o ideal cadastrados). Cadastre a ficha técnica na página do produto, no Cardápio.
        </p>
      )}

      {items.length === 0 ? <Empty>Cadastre itens no estoque para ver sugestões.</Empty> : (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">Lista sugerida ({toBuy.length} {toBuy.length === 1 ? "item" : "itens"})</h2>
            {toBuy.length > 0 && (
              <form action={createPurchaseList}><Button type="submit" className="min-h-11 px-4 text-sm">Montar lista de compras para revisar</Button></form>
            )}
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Sugestões de compra">
            <table className="w-full min-w-[820px] text-sm" data-testid="suggestions">
              <thead><tr className="text-left text-coffee-soft">
                <th className="py-1 pr-2">Item</th><th className="pr-2 text-right">Estoque</th><th className="pr-2 text-right">Saiu em 7 dias</th><th className="pr-2 text-right">Segurança</th>
                <th className="pr-2 text-right">Comprar</th>{hasPermission(membership, "financeiro.ver") && <th className="pr-2 text-right">Custo estimado</th>}<th>Por quê</th>
              </tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={`border-t border-cream ${item.suggested > 0 ? "" : "text-coffee-soft"}`} data-testid="suggestion">
                    <td className="py-2 pr-2"><Link href={`/lojista/estoque/${item.id}`} className="font-semibold underline">{item.name}</Link>
                      <span className="block text-xs text-coffee-soft">{TREND[item.trend]}{item.supplier ? ` · ${item.supplier}` : ""}</span></td>
                    <td className="pr-2 text-right tabular-nums">{qty(item.quantity, item.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(item.out7, item.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(item.safetyStock, item.unit)}</td>
                    <td className="pr-2 text-right font-bold tabular-nums">{item.suggested > 0 ? qty(item.suggested, item.unit) : "—"}</td>
                    {hasPermission(membership, "financeiro.ver") && <td className="pr-2 text-right tabular-nums">{item.suggested > 0 && item.estimatedCostCents !== null ? formatCents(item.estimatedCostCents) : "—"}</td>}
                    <td className="text-xs">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasPermission(membership, "financeiro.ver") && totalCost > 0 && <p className="mt-2 text-sm">Custo estimado da lista (pelos custos cadastrados): <strong>{formatCents(totalCost)}</strong></p>}
        </section>
      )}

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="mb-2 text-xl">Listas de compras</h2>
        {lists.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma lista ainda.</p> : (
          <ul className="divide-y divide-cream text-sm">
            {lists.map((list) => (
              <li key={list.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link href={`/lojista/estoque/reposicao/${list.id}`} className="font-semibold underline">Lista de {formatDateTime(list.created_at)}</Link> · {list.items} itens · {list.by_name}</span>
                <span className="font-semibold">{LIST_STATUS[list.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
