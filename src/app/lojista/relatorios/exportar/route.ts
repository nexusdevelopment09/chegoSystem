import { businessDate } from "@/lib/fees/rules";
import { getMerchantContext } from "@/lib/merchant/context";
import { csvCell } from "@/lib/merchant/csv";
import { loadReportOrders, MODALITIES, parseReportFilters } from "@/lib/merchant/report-data";
import { SEGMENTS, saleCents } from "@/lib/merchant/report-rules";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const date = (value: Date) => new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;

// Planilha dos pedidos com os mesmos filtros (e o mesmo segmento) da tela de relatórios.
// Sem nome, telefone ou endereço dos clientes: só o que serve para conferir as vendas.
export async function GET(request: Request) {
  const { store, at } = await getMerchantContext("relatorios.exportar");
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = parseReportFilters(params, businessDate(at, 0));
  const all = await loadReportOrders(store.id, filters);
  const segment = filters.segmento ? SEGMENTS[filters.segmento] : null;
  const orders = segment ? all.filter((order) => segment.test(order, at)) : all;

  const header = "pedido;pago_em;situacao;total_pago;canal;pagamento;itens;produtos;desconto;taxa_entrega;reembolso;vendas;taxa_chego;custo_estimado";
  const rows = orders.map((order) => [
    order.code, date(order.paidAt), csvCell(STATUS_LABELS[order.status as OrderStatus] ?? order.status), money(order.totalCents),
    MODALITIES[order.channel === "app" ? order.fulfillment : order.channel], PAYMENT[order.paymentMethod], order.itemsCount,
    money(order.subtotalCents), money(order.discountCents), money(order.deliveryFeeCents), money(order.refundedCents), money(saleCents(order)),
    money(order.platformFeeCents), order.costCents === null ? "" : money(order.costCents),
  ].join(";"));

  return new Response(`﻿${[header, ...rows].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${store.slug}-${filters.from}-a-${filters.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
