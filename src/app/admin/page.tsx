import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { Bars, Stat } from "@/components/ui/Stats";
import { dashboard } from "@/lib/admin/metrics";
import { PERIODS, withQuery } from "@/lib/admin/period";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { storeAvailability, type Shift } from "@/lib/stores/hours";
import { DAY_MS, fromLocal, toLocal } from "@/lib/time";

export const metadata: Metadata = { title: "Painel do admin" };

type SearchParams = Promise<{ periodo?: string; cidade?: string }>;

export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole("admin");
  const params = await searchParams;
  const periodKey = PERIODS.some((period) => period.key === params.periodo) ? params.periodo! : "30";
  const at = await now();
  const from = periodKey === "hoje" ? fromLocal(toLocal(at).date, 0) : new Date(at.getTime() - Number(periodKey) * DAY_MS);

  const cities = await sql<{ id: string; name: string }[]>`select id, name from cities order by name`;
  const cityId = cities.find((city) => city.id === params.cidade)?.id ?? null;

  const [data, pending, tickets, storeRows] = await Promise.all([
    dashboard({ from, to: at }, cityId),
    sql<{ total: number }[]>`select count(*)::int as total from stores where status = 'pending'`,
    sql<{ total: number }[]>`select count(*)::int as total from support_tickets where status <> 'resolved'`,
    sql<{ status: "active" | "paused"; manual_state: "auto" | "open" | "closed"; paused_until: Date | null; shifts: Shift[] }[]>`
      select s.status, s.manual_state, s.paused_until,
             coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text, 'closesAt', h.closes_at::text))
                       from store_hours h where h.store_id = s.id), '[]') as shifts
      from stores s where s.status in ('active', 'paused') ${cityId ? sql`and s.city_id = ${cityId}` : sql``}`,
  ]);
  const openNow = storeRows.filter((store) =>
    storeAvailability({ status: store.status, manualState: store.manual_state, pausedUntil: store.paused_until, shifts: store.shifts, closures: [] }, at).state === "open").length;

  const href = (changes: Record<string, string>) => {
    const query = new URLSearchParams({ periodo: periodKey, ...(cityId ? { cidade: cityId } : {}), ...changes });
    return `/admin?${query}`;
  };
  const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(0)}%`);
  // Cada número abre a lista que o explica, com o mesmo período e a mesma cidade.
  const cut = { periodo: periodKey, cidade: cityId };
  const ordersLink = (extra: Record<string, string>) => withQuery("/admin/pedidos", { ...cut, ...extra });
  const moneyLink = withQuery("/admin/financeiro", cut);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl">Oi, {profile.fullName}!</h1>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((period) => (
            <Link key={period.key} href={href({ periodo: period.key })} aria-current={period.key === periodKey ? "true" : undefined}
              className={buttonClass(period.key === periodKey ? "primary" : "secondary", "min-h-11 px-4 text-sm")}>{period.label}</Link>
          ))}
          <form className="flex gap-1">
            <input type="hidden" name="periodo" value={periodKey} />
            <select name="cidade" defaultValue={cityId ?? ""} aria-label="Cidade" className={`${inputClass} min-h-11 w-auto`}>
              <option value="">Todas as cidades</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
            <button type="submit" className={buttonClass("secondary", "min-h-11 px-3 text-sm")}>Filtrar</button>
          </form>
        </div>
      </header>

      {(pending[0].total > 0 || tickets[0].total > 0) && (
        <div className="flex flex-wrap gap-2">
          {pending[0].total > 0 && (
            <Link href="/admin/lojas?situacao=pending" className="rounded-full bg-brand px-4 py-2 font-bold text-coffee">
              {pending[0].total} loja{pending[0].total > 1 ? "s" : ""} esperando aprovação
            </Link>
          )}
          {tickets[0].total > 0 && (
            <Link href="/admin/suporte" className="rounded-full bg-peach px-4 py-2 font-bold">
              {tickets[0].total} chamado{tickets[0].total > 1 ? "s" : ""} de suporte em aberto
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos" value={data.orders} href={ordersLink({ situacao: "vendidos" })} />
        <Stat label="Faturamento total (GMV)" value={formatCents(data.gmvCents)} hint="Tudo o que os clientes pagaram, sem os reembolsos" href={ordersLink({ situacao: "vendidos" })} />
        <Stat label="Receita da plataforma" value={formatCents(data.platformRevenueCents)} hint="Comissões + taxas de serviço + mensalidades − cupons pagos pela plataforma" href={moneyLink} />
        <Stat label="Ticket médio" value={formatCents(data.ticketCents)} href={ordersLink({ situacao: "vendidos" })} />
        <Stat label="Clientes novos" value={data.newCustomers} href={withQuery("/admin/clientes", { ...cut, novos: "1" })} />
        <Stat label="Recompra em 30 dias" value={percent(data.repurchaseRate)} hint="Clientes que compraram mais de uma vez" href={withQuery("/admin/clientes", { cidade: cityId, recompra: "1" })} />
        <Stat label="Recusas e cancelamentos" value={`${data.rejected} / ${data.cancelled}`} hint="Recusados pela loja / cancelados" href={ordersLink({ situacao: "problemas" })} />
        <Stat label="Lojas abertas agora" value={`${openNow} de ${data.activeStores}`} href={withQuery("/admin/lojas", { cidade: cityId, abertas: "1" })} />
        <Stat label="Tempo médio de aceite" value={data.avgAcceptMinutes === null ? "—" : `${data.avgAcceptMinutes} min`} href={ordersLink({ situacao: "vendidos" })} />
        <Stat label="Tempo médio de entrega" value={data.avgDeliveryMinutes === null ? "—" : `${data.avgDeliveryMinutes} min`} hint="Do pagamento até a entrega" href={ordersLink({ situacao: "entregues" })} />
        <Stat label="Comissões" value={formatCents(data.commissionCents)} href={moneyLink} />
        <Stat label="Mensalidades" value={formatCents(data.subscriptionCents)} href={moneyLink} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Vendas por dia</h2>
          {data.byDay.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars format={formatCents} rows={data.byDay.slice(-31).map((row) => ({
                label: row.day.split("-").reverse().slice(0, 2).join("/"), value: row.gmvCents,
                href: withQuery("/admin/pedidos", { dia: row.day, cidade: cityId, situacao: "vendidos" }),
              }))} />}
        </section>
        <section className="rounded-card bg-white p-4 ring-1 ring-peach">
          <h2 className="mb-2 text-xl">Lojas que mais venderam</h2>
          {data.byStore.length === 0
            ? <p className="text-sm text-coffee-soft">Nenhuma venda no período.</p>
            : <Bars format={formatCents} rows={data.byStore.map((row) => ({ label: row.name, value: row.gmvCents, href: ordersLink({ situacao: "vendidos", loja: row.id }) }))} />}
        </section>
      </div>
    </div>
  );
}
