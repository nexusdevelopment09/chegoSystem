import "server-only";
import { sql } from "@/lib/db";

// Números da plataforma inteira para o admin. "Vendido" = pago e não recusado,
// cancelado, expirado nem reembolsado por inteiro.

export type Period = { from: Date; to: Date };

export type CommissionLine = {
  storeId: string; storeName: string; document: string | null; orders: number; gmvCents: number;
  commissionCents: number; serviceFeeCents: number; subscriptionCents: number;
};

/** O que cada loja pagou à plataforma em um período: a base das notas do contador. */
export async function commissionsByStore(period: Period): Promise<CommissionLine[]> {
  const rows = await sql<{
    id: string; name: string; document: string | null; orders: number; gmv: number; commission: number; fee: number; subscription: number;
  }[]>`
    select s.id, s.name, sp.document_number as document,
           count(o.id)::int as orders,
           coalesce(sum(o.total_cents - o.refunded_cents), 0)::int as gmv,
           coalesce(sum(o.commission_cents), 0)::int as commission,
           coalesce(sum(o.service_fee_cents), 0)::int as fee,
           coalesce((select sum(i.amount_cents) from invoices i
                     where i.store_id = s.id and i.status = 'paid' and i.paid_at >= ${period.from} and i.paid_at < ${period.to}), 0)::int as subscription
    from stores s
    join store_private sp on sp.store_id = s.id
    left join orders o on o.store_id = s.id and o.paid_at >= ${period.from} and o.paid_at < ${period.to}
      and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')
    group by s.id, s.name, sp.document_number
    having count(o.id) > 0 or exists (
      select 1 from invoices i where i.store_id = s.id and i.status = 'paid' and i.paid_at >= ${period.from} and i.paid_at < ${period.to})
    order by commission desc, s.name`;

  return rows.map((row) => ({
    storeId: row.id, storeName: row.name, document: row.document, orders: row.orders, gmvCents: row.gmv,
    commissionCents: row.commission, serviceFeeCents: row.fee, subscriptionCents: row.subscription,
  }));
}

export type Mismatch = { orderId: string; code: string; storeName: string; problem: string };

/**
 * Conciliação: o que o gateway diz que cobrou, dividiu e devolveu
 * contra o que o sistema calculou. Qualquer linha aqui precisa de um olhar humano.
 */
export async function reconciliation(period: Period): Promise<{ checked: number; mismatches: Mismatch[] }> {
  const rows = await sql<{
    id: string; code: string; store_name: string; total_cents: number; store_amount_cents: number; platform_amount_cents: number;
    refunded_cents: number; status: string; paid_amount: number | null; gateway_store: number | null; gateway_platform: number | null;
    payments_approved: number; refunds_total: number; ledger_net: number;
  }[]>`
    select o.id, o.code, s.name as store_name, o.total_cents, o.store_amount_cents, o.platform_amount_cents, o.refunded_cents, o.status,
           p.amount_cents as paid_amount,
           (p.raw_payload -> 'split' ->> 'storeAmountCents')::int as gateway_store,
           (p.raw_payload -> 'split' ->> 'platformAmountCents')::int as gateway_platform,
           (select count(*)::int from payments x where x.order_id = o.id and x.status in ('approved', 'refunded', 'partially_refunded')) as payments_approved,
           coalesce((select sum(r.amount_cents) from refunds r where r.order_id = o.id), 0)::int as refunds_total,
           coalesce((select sum(case when l.direction = 'credit' then l.amount_cents else -l.amount_cents end)
                     from ledger_entries l where l.order_id = o.id), 0)::int as ledger_net
    from orders o
    join stores s on s.id = o.store_id
    left join lateral (
      select amount_cents, raw_payload from payments x
      where x.order_id = o.id and x.status in ('approved', 'refunded', 'partially_refunded')
      order by x.created_at desc limit 1
    ) p on true
    where o.paid_at >= ${period.from} and o.paid_at < ${period.to}
    order by o.paid_at desc`;

  const mismatches: Mismatch[] = [];
  for (const row of rows) {
    const problems: string[] = [];
    if (row.payments_approved === 0) problems.push("pedido pago sem pagamento aprovado no gateway");
    if (row.payments_approved > 1) problems.push("mais de um pagamento aprovado para o mesmo pedido");
    if (row.paid_amount !== null && row.paid_amount !== row.total_cents) problems.push("valor cobrado diferente do total do pedido");
    if (row.gateway_store !== null && row.gateway_store !== row.store_amount_cents) problems.push("parte da loja no split diferente da calculada");
    if (row.gateway_platform !== null && row.gateway_platform !== row.platform_amount_cents) problems.push("parte da plataforma no split diferente da calculada");
    if (row.refunds_total !== row.refunded_cents) problems.push("reembolsos registrados não batem com o valor devolvido no pedido");
    if (row.ledger_net !== row.total_cents - row.refunded_cents) problems.push("lançamentos do financeiro não fecham com o pedido");
    for (const problem of problems) mismatches.push({ orderId: row.id, code: row.code, storeName: row.store_name, problem });
  }
  return { checked: rows.length, mismatches };
}
