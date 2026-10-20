import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import type { StockUnit } from "@/lib/inventory/rules";
import { approvePurchaseList, cancelPurchaseList, receivePurchaseList, updatePurchaseItem } from "../../actions";
import { qty, StockNav } from "../../StockParts";

export const metadata: Metadata = { title: "Lista de compras" };

export default function PurchaseListPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <PurchaseList params={params} />
    </Suspense>
  );
}

async function PurchaseList({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { membership, store } = await getMerchantContext("reposicao.ver");
  const [list] = await sql<{ status: "rascunho" | "aprovada" | "recebida" | "cancelada"; created_at: Date; approved_at: Date | null; received_at: Date | null; approved_name: string | null }[]>`
    select l.status, l.created_at, l.approved_at, l.received_at, p.full_name as approved_name
    from purchase_lists l left join profiles p on p.id = l.approved_by where l.id = ${id} and l.store_id = ${store.id}`;
  if (!list) notFound();
  const items = await sql<{ id: string; item_id: string; name: string; unit: StockUnit; supplier: string | null; suggested: string; quantity: string; unit_cost_cents: number | null; reason: string | null }[]>`
    select li.id, li.item_id, i.name, i.unit, i.supplier, li.suggested_quantity::text as suggested, li.quantity::text, li.unit_cost_cents, li.reason
    from purchase_list_items li join stock_items i on i.id = li.item_id where li.list_id = ${id} order by i.supplier nulls last, i.name`;
  const draft = list.status === "rascunho";
  const total = items.reduce((sum, item) => sum + (item.unit_cost_cents ?? 0) * Number(item.quantity), 0);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/lojista/estoque/reposicao" className="inline-flex min-h-11 items-center self-start font-semibold text-brand-dark">← Reposição</Link>
      <StockNav current="/lojista/estoque/reposicao" />
      <header>
        <h1 className="text-3xl">Lista de compras</h1>
        <p className="text-coffee-soft" data-testid="list-status">
          {list.status === "rascunho" && "Rascunho: revise as quantidades e aprove. Aprovar não compra nada; só marca que a loja vai comprar."}
          {list.status === "aprovada" && `Aprovada${list.approved_name ? ` por ${list.approved_name}` : ""} em ${formatDateTime(list.approved_at!)}. Quando a compra chegar, registre a entrada.`}
          {list.status === "recebida" && `Recebida em ${formatDateTime(list.received_at!)}: as quantidades entraram no estoque.`}
          {list.status === "cancelada" && "Cancelada."}
        </p>
      </header>
      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <ul className="divide-y divide-cream" data-testid="purchase-items">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.name}{item.supplier && <span className="font-normal text-coffee-soft"> · {item.supplier}</span>}</p>
                <p className="text-xs text-coffee-soft">Sugerido: {qty(Number(item.suggested), item.unit)} · {item.reason}</p>
              </div>
              {draft ? (
                <ActionForm action={updatePurchaseItem} className="flex items-end gap-2">
                  <input type="hidden" name="id" value={item.id} />
                  <label className="flex flex-col text-xs font-semibold">Comprar
                    <input name="quantity" inputMode="decimal" defaultValue={String(Number(item.quantity)).replace(".", ",")} aria-label={`Quantidade de ${item.name}`} className="min-h-11 w-24 rounded-xl px-2 ring-1 ring-peach" />
                  </label>
                  <SubmitButton variant="secondary" className="min-h-11 px-3 text-xs">Salvar</SubmitButton>
                </ActionForm>
              ) : (
                <p className="font-bold tabular-nums">{qty(Number(item.quantity), item.unit)}</p>
              )}
            </li>
          ))}
        </ul>
        {total > 0 && hasPermission(membership, "financeiro.ver") && <p className="mt-2 text-sm">Custo estimado: <strong>{formatCents(Math.round(total))}</strong></p>}
      </section>
      <div className="flex flex-wrap gap-2">
        {draft && hasPermission(membership, "estoque.ajustar") && (
          <form action={approvePurchaseList}><input type="hidden" name="id" value={id} /><Button type="submit" className="min-h-11 px-4 text-sm">Aprovar lista</Button></form>
        )}
        {list.status === "aprovada" && hasPermission(membership, "estoque.movimentar") && (
          <ActionForm action={receivePurchaseList} className="flex">
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="min-h-11 px-4 text-sm">A compra chegou: registrar entrada</SubmitButton>
          </ActionForm>
        )}
        {(draft || list.status === "aprovada") && (
          <form action={cancelPurchaseList}><input type="hidden" name="id" value={id} /><Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">Cancelar lista</Button></form>
        )}
      </div>
    </div>
  );
}
