import { businessDate } from "@/lib/fees/rules";
import { monthlyByYear } from "@/lib/merchant/annual";
import { getMerchantContext } from "@/lib/merchant/context";
import { equivalentCutoff, summarizeYears } from "@/lib/merchant/report-rules";

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

// Planilha do relatório anual: uma linha por ano e mês, com os mesmos anos e o mesmo recorte da tela.
export async function GET(request: Request) {
  const { store, at } = await getMerchantContext("relatorios.exportar");
  const params = new URL(request.url).searchParams;
  const today = businessDate(at, 0);
  const current = Number(today.slice(0, 4));
  const years = [...new Set((params.get("anos") ?? "").split(",").map(Number).filter((year) => Number.isInteger(year) && year >= 2000 && year <= current))].slice(0, 4);
  const cutoff = params.get("equivalente") === "0" ? null : equivalentCutoff(years, today);
  const summaries = summarizeYears(await monthlyByYear(store.id, years, cutoff), years);

  const header = "ano;mes;pedidos_recebidos;pedidos_vendidos;concluidos;cancelados;faturamento_bruto;descontos;estornos;vendas;taxas_chego;itens";
  const rows = summaries.flatMap((summary) => summary.months.flatMap((month, index) => (month
    ? [[summary.year, index + 1, month.received, month.sold, month.completed, month.cancelled, money(month.grossCents), money(month.discountCents),
        money(month.refundCents), money(month.salesCents), money(month.feeCents), month.items].join(";")]
    : [])));
  const note = cutoff ? `# recorte: de 1/1 a ${cutoff.day}/${cutoff.month} de cada ano` : "# anos inteiros";
  return new Response(`﻿${[header, ...rows, note].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="anual-${store.slug}-${years.join("-")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
