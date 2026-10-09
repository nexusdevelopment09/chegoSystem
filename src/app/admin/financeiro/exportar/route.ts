import { commissionsByStore } from "@/lib/admin/metrics";
import { requireRole } from "@/lib/auth/session";

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

// Monthly report of what each store paid the platform, for the accountant to issue the invoices.
export async function GET(request: Request) {
  await requireRole("admin");
  const month = new URL(request.url).searchParams.get("mes") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Mês inválido", { status: 400 });

  const [year, index] = month.split("-").map(Number);
  const start = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1, 3));
  const lines = await commissionsByStore({ from: start(year, index), to: index === 12 ? start(year + 1, 1) : start(year, index + 1) });

  const header = "mes;loja;documento;pedidos;vendas;comissao;taxa_de_servico;mensalidade;total_a_faturar";
  const rows = lines.map((line) => [
    month, `"${line.storeName.replace(/"/g, '""')}"`, line.document ?? "", line.orders, money(line.gmvCents), money(line.commissionCents),
    money(line.serviceFeeCents), money(line.subscriptionCents), money(line.commissionCents + line.serviceFeeCents + line.subscriptionCents),
  ].join(";"));

  return new Response(`﻿${[header, ...rows].join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comissoes-chego-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
