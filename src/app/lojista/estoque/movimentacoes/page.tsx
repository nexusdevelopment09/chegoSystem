import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { inputClass } from "@/components/ui/Field";
import { formatDateTime } from "@/lib/format";
import { listMovements } from "@/lib/inventory/queries";
import { MOVEMENT_LABELS, type MovementKind } from "@/lib/inventory/rules";
import { getMerchantContext } from "@/lib/merchant/context";
import { fromLocal } from "@/lib/time";
import { addDays } from "@/lib/fees/rules";
import { Empty, qty, StockNav } from "../StockParts";

export const metadata: Metadata = { title: "Movimentações do estoque" };

type SearchParams = Promise<{ tipo?: string; de?: string; ate?: string; pagina?: string }>;
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Movements searchParams={searchParams} />
    </Suspense>
  );
}

async function Movements({ searchParams }: { searchParams: SearchParams }) {
  const [params, { store }] = await Promise.all([searchParams, getMerchantContext("estoque.ver")]);
  const kind = params.tipo && params.tipo in MOVEMENT_LABELS ? (params.tipo as MovementKind) : undefined;
  const page = Math.max(1, Number(params.pagina) || 1);
  const { total, rows } = await listMovements(store.id, {
    kind, from: params.de && DATE.test(params.de) ? fromLocal(params.de, 0) : undefined,
    to: params.ate && DATE.test(params.ate) ? fromLocal(addDays(params.ate, 1), 0) : undefined, limit: PAGE, offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (target: number) => `?${new URLSearchParams({ ...(kind ? { tipo: kind } : {}), ...(params.de ? { de: params.de } : {}), ...(params.ate ? { ate: params.ate } : {}), pagina: String(target) })}`;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl">Movimentações</h1>
        <p className="text-coffee-soft">Toda entrada e saída do estoque, com quem fez, o motivo e o pedido ligado. Nada aqui pode ser apagado.</p>
      </header>
      <StockNav current="/lojista/estoque/movimentacoes" />
      <form method="get" className="grid gap-2 rounded-card bg-white p-3 ring-1 ring-peach sm:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs font-semibold">Tipo
          <select name="tipo" defaultValue={kind ?? ""} className={inputClass}><option value="">Todos</option>{Object.entries(MOVEMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">De<input type="date" name="de" defaultValue={params.de ?? ""} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold">Até<input type="date" name="ate" defaultValue={params.ate ?? ""} className={inputClass} /></label>
        <button className="min-h-11 self-end rounded-full bg-brand-dark px-5 text-sm font-bold text-white">Filtrar</button>
      </form>
      {total === 0 ? <Empty>Nenhuma movimentação com esses filtros.</Empty> : (
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <p className="mb-2 text-sm text-coffee-soft">{total} movimentaç{total === 1 ? "ão" : "ões"}</p>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Movimentações">
            <table className="w-full min-w-[720px] text-sm" data-testid="movements">
              <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Quando</th><th className="pr-2">Item</th><th className="pr-2">Tipo</th><th className="pr-2 text-right">Quantidade</th><th className="pr-2 text-right">Saldo</th><th>Motivo e responsável</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-cream">
                    <td className="py-1 pr-2">{formatDateTime(row.createdAt)}</td>
                    <td className="pr-2"><Link href={`/lojista/estoque/${row.itemId}`} className="underline">{row.itemName}</Link></td>
                    <td className="pr-2">{MOVEMENT_LABELS[row.kind]}</td>
                    <td className={`pr-2 text-right font-semibold tabular-nums ${row.quantity < 0 ? "text-danger" : "text-success"}`}>{row.quantity > 0 ? "+" : ""}{qty(row.quantity, row.unit)}</td>
                    <td className="pr-2 text-right tabular-nums">{qty(row.balanceAfter, row.unit)}</td>
                    <td className="text-coffee-soft">{row.reason ?? ""}{row.orderCode && <> · pedido <Link href={`/lojista/pedidos/${row.orderId}`} className="underline">{row.orderCode}</Link></>} · {row.byName ?? row.process ?? "sistema"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Páginas" className="mt-3 flex items-center gap-2 text-sm">
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
