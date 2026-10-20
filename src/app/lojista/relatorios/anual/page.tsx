import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Bars } from "@/components/ui/Stats";
import { YEAR_COLORS, YearChart } from "@/components/ui/YearChart";
import { hasPermission } from "@/lib/auth/session";
import { businessDate } from "@/lib/fees/rules";
import { formatCents } from "@/lib/format";
import { availableYears, breakdownsByYear, monthlyByYear } from "@/lib/merchant/annual";
import { getMerchantContext } from "@/lib/merchant/context";
import { MODALITIES } from "@/lib/merchant/report-data";
import { change, equivalentCutoff, summarizeYears, type YearSummary } from "@/lib/merchant/report-rules";

export const metadata: Metadata = { title: "Relatório anual" };

type SearchParams = Promise<{ anos?: string; equivalente?: string }>;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;

export default function AnnualPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" aria-label="Carregando relatório anual" />}>
      <Annual searchParams={searchParams} />
    </Suspense>
  );
}

async function Annual({ searchParams }: { searchParams: SearchParams }) {
  const [params, { membership, store, at }] = await Promise.all([searchParams, getMerchantContext("relatorios.ver")]);
  const today = businessDate(at, 0);
  const currentYear = Number(today.slice(0, 4));
  const available = await availableYears(store.id);
  // Até 4 anos: os escolhidos (com ou sem dados, para dizer "sem dados") ou os 3 mais recentes.
  const asked = (params.anos ?? "").split(",").map(Number).filter((year) => Number.isInteger(year) && year >= 2000 && year <= currentYear);
  const years = [...new Set(asked.length > 0 ? asked : [currentYear, currentYear - 1, currentYear - 2])].sort((a, b) => b - a).slice(0, 4);
  const cutoff = params.equivalente === "0" ? null : equivalentCutoff(years, today);
  const [rows, breakdowns] = await Promise.all([monthlyByYear(store.id, years, cutoff), breakdownsByYear(store.id, years, cutoff)]);
  const summaries = summarizeYears(rows, years);
  const canMoney = hasPermission(membership, "financeiro.ver");
  const pct = (current: YearSummary, field: keyof YearSummary) => {
    const previous = summaries.find((item) => item.year === current.year - 1);
    if (!previous || !previous.hasData || !current.hasData) return null;
    return change(current[field] as number, previous[field] as number);
  };
  const toggle = (year: number) => {
    const next = years.includes(year) ? years.filter((item) => item !== year) : [...years, year];
    return `?anos=${next.sort((a, b) => b - a).join(",")}${params.equivalente === "0" ? "&equivalente=0" : ""}`;
  };
  const yearOptions = [...new Set([...available, currentYear, currentYear - 1, currentYear - 2])].sort((a, b) => b - a).slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/lojista/relatorios" className="inline-flex min-h-11 items-center self-start font-semibold text-brand-dark">← Relatórios</Link>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl">Relatório anual</h1>
          <p className="text-coffee-soft">Vendas por ano e mês, no horário de Maceió. Anos sem pedido aparecem como “sem dados”.</p>
        </div>
        {hasPermission(membership, "relatorios.exportar") && (
          <a href={`/lojista/relatorios/anual/exportar?anos=${years.join(",")}${cutoff ? "" : "&equivalente=0"}`} download className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Baixar CSV</a>
        )}
      </header>

      <nav aria-label="Anos" className="flex flex-wrap items-center gap-2">
        {yearOptions.map((year) => (
          <Link key={year} href={toggle(year)} aria-pressed={years.includes(year)} aria-current={years.includes(year) ? "true" : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-sm font-bold ring-1 ${years.includes(year) ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach"}`}>
            {year}{!available.includes(year) && " (sem dados)"}
          </Link>
        ))}
      </nav>
      <p className={`rounded-2xl px-4 py-3 text-sm ${cutoff ? "bg-peach" : "bg-cream"}`} data-testid="annual-cutoff">
        {cutoff
          ? <>Comparação equivalente: cada ano vai de 1º de janeiro até <strong>{cutoff.day} de {MONTHS[cutoff.month - 1]}</strong>, porque {currentYear} ainda não acabou. </>
          : years.includes(currentYear)
            ? <><strong>{currentYear} ainda não acabou</strong>: os totais dele não são comparáveis com anos completos. </>
            : "Anos completos. "}
        {years.includes(currentYear) && years.length > 1 && (
          <Link href={`?anos=${years.join(",")}${cutoff ? "&equivalente=0" : ""}`} className="font-semibold text-brand-dark underline">{cutoff ? "Ver os anos inteiros" : "Comparar até o mesmo dia"}</Link>
        )}
      </p>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Comparação entre anos">
          <table className="w-full min-w-[640px] text-sm" data-testid="annual-table">
            <thead><tr className="text-left text-coffee-soft"><th className="py-1 pr-2">Indicador</th>{summaries.map((item, index) => (
              <th key={item.year} className="pr-2 text-right"><span className="mr-1 inline-block size-2.5 rounded-sm align-middle" style={{ background: YEAR_COLORS[index] }} />{item.year}</th>
            ))}</tr></thead>
            <tbody>
              {([
                ["Pedidos recebidos", "received", false], ["Pedidos vendidos", "sold", false], ["Concluídos", "completed", false], ["Recusados e cancelados", "cancelled", false],
                ...(canMoney ? [["Faturamento bruto", "grossCents", true], ["Descontos", "discountCents", true], ["Estornos", "refundCents", true], ["Vendas", "salesCents", true],
                  ["Taxas do Chegô", "feeCents", true], ["Receita líquida operacional", "netOperatingCents", true], ["Ticket médio", "ticketCents", true]] : []),
                ["Itens vendidos", "items", false],
              ] as [string, keyof YearSummary, boolean][]).map(([label, field, isMoney]) => (
                <tr key={field} className="border-t border-cream">
                  <td className="py-1.5 pr-2">{label}</td>
                  {summaries.map((item) => {
                    const delta = pct(item, field);
                    return (
                      <td key={item.year} className="pr-2 text-right tabular-nums">
                        {item.hasData ? (isMoney ? formatCents(item[field] as number) : String(item[field])) : <span className="text-coffee-soft">sem dados</span>}
                        {delta && delta.pct !== null && <span className={`block text-xs ${delta.direction === "up" ? "text-success" : delta.direction === "down" ? "text-danger" : "text-coffee-soft"}`}>{delta.pct > 0 ? "+" : ""}{delta.pct.toLocaleString("pt-BR")}% vs {item.year - 1}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {canMoney && (
                <tr className="border-t border-cream"><td className="py-1.5 pr-2">Melhor e pior mês</td>{summaries.map((item) => (
                  <td key={item.year} className="pr-2 text-right text-xs">{item.bestMonth ? <>↑ {MONTHS[item.bestMonth.month - 1]}{item.worstMonth && <><br />↓ {MONTHS[item.worstMonth.month - 1]}</>}</> : "—"}</td>
                ))}</tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {summaries.some((item) => item.hasData) ? (
        <section className="flex flex-col gap-6 rounded-card bg-white p-4 ring-1 ring-peach">
          {canMoney && <YearChart testId="chart-sales" title="Vendas por mês" kind="money" series={summaries.map((item) => ({ label: String(item.year), values: item.months.map((month) => month?.salesCents ?? null) }))} />}
          <YearChart testId="chart-orders" title="Pedidos vendidos por mês" kind="orders" series={summaries.map((item) => ({ label: String(item.year), values: item.months.map((month) => month?.sold ?? null) }))} />
          {canMoney && <YearChart testId="chart-ticket" title="Ticket médio por mês" kind="money" series={summaries.map((item) => ({ label: String(item.year), values: item.months.map((month) => (month && month.sold > 0 ? Math.round(month.salesCents / month.sold) : null)) }))} />}
        </section>
      ) : (
        <p role="status" className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum pedido nos anos escolhidos.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {summaries.filter((item) => item.hasData).map((item) => (
          <section key={item.year} className="rounded-card bg-white p-4 ring-1 ring-peach">
            <h2 className="mb-2 text-xl">{item.year}: mais vendidos</h2>
            <Bars rows={breakdowns.products.filter((row) => row.year === item.year).map((row) => ({ label: row.name, value: row.quantity }))} format={(value) => `${value} un.`} />
            {canMoney && (
              <>
                <h3 className="mb-1 mt-3 font-sans text-sm font-bold uppercase text-coffee-soft">Pagamento</h3>
                <Bars rows={breakdowns.payments.filter((row) => row.year === item.year).map((row) => ({ label: `${PAYMENT[row.method]} (${row.count})`, value: row.total_cents }))} format={formatCents} />
                <h3 className="mb-1 mt-3 font-sans text-sm font-bold uppercase text-coffee-soft">Canal</h3>
                <Bars rows={breakdowns.channels.filter((row) => row.year === item.year).map((row) => ({ label: `${MODALITIES[row.channel as keyof typeof MODALITIES] ?? row.channel} (${row.count})`, value: row.total_cents }))} format={formatCents} />
              </>
            )}
          </section>
        ))}
      </div>
      <p className="text-xs text-coffee-soft">
        Vendas = o que os clientes pagaram, já sem descontos e reembolsos. Receita líquida operacional = vendas − taxas do Chegô (não é lucro).
        Para salvar em PDF, use “Imprimir” do navegador e escolha “Salvar como PDF”.
      </p>
    </div>
  );
}
