import { getMerchantContext } from "@/lib/merchant/context";
import { payoutDate, storeStatement } from "@/lib/merchant/reports";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { DAY_MS } from "@/lib/time";

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const date = (value: Date) => new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");

// As vendas da loja, um pedido por linha, para abrir em uma planilha.
export async function GET(request: Request) {
  const { store, at } = await getMerchantContext(["owner"]);
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 30));
  const lines = await storeStatement(store.id, { from: new Date(at.getTime() - days * DAY_MS), to: at });

  const header = "pedido;pago_em;situacao;total_pago;taxa_entrega;comissao;desconto_da_loja;reembolso_da_loja;liquido_da_loja;repasse_previsto";
  const rows = lines.map((line) => [
    line.code, date(line.paidAt), STATUS_LABELS[line.status as OrderStatus] ?? line.status, money(line.grossCents),
    money(line.deliveryFeeCents), money(line.commissionCents), money(line.storeDiscountCents),
    money(line.refundedFromStoreCents), money(line.netCents), date(payoutDate(line.paidAt)).slice(0, 10),
  ].join(";"));

  return new Response(`﻿${[header, ...rows].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vendas-${store.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
