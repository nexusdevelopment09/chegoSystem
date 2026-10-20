import "server-only";
import { sql } from "@/lib/db";

// Desempenho real das taxas do Chegô, só a partir dos registros financeiros gravados
// (fee_entries, store_closings, fee_payments). Nunca mistura com o simulador.

export type FeePerformance = {
  /** Lojas com pelo menos um pedido concluído (com taxa) no período. */
  activeStores: number;
  /** Pedidos com taxa no período, já descontados os estornos. */
  eligibleOrders: number;
  /** Taxas lançadas no período (taxas menos estornos). Gerado não é recebido. */
  generatedCents: number;
  reversedCents: number;
  /** Pagamentos Pix confirmados e aplicados no período: dinheiro que entrou de fato. */
  paidCents: number;
  /** O que as lojas devem hoje em fechamentos ainda não pagos (aguardando, vencidos, em análise). */
  pendingCents: number;
  /** Taxas lançadas no período que ainda não entraram em nenhum fechamento. */
  openCents: number;
};

export async function feePerformance(period: { from: string; to: string }): Promise<FeePerformance> {
  const [entries] = await sql<{ active_stores: number; orders: number; generated: number; reversed: number; open_cents: number }[]>`
    select count(distinct store_id) filter (where kind = 'order_fee')::int as active_stores,
           (count(*) filter (where kind = 'order_fee') - count(*) filter (where kind = 'order_fee_reversal'))::int as orders,
           coalesce(sum(amount_cents) filter (where kind in ('order_fee', 'order_fee_reversal')), 0)::int as generated,
           coalesce(-sum(amount_cents) filter (where kind = 'order_fee_reversal'), 0)::int as reversed,
           coalesce(sum(amount_cents) filter (where closing_id is null), 0)::int as open_cents
    from fee_entries
    where business_date between ${period.from} and ${period.to}`;
  const [paid] = await sql<{ cents: number }[]>`
    select coalesce(sum(amount_cents), 0)::int as cents from fee_payments
    where applied and (received_at at time zone 'America/Maceio')::date between ${period.from} and ${period.to}`;
  const [pending] = await sql<{ cents: number }[]>`
    select coalesce(sum(total_due_cents), 0)::int as cents from store_closings
    where status in ('awaiting_payment', 'overdue', 'in_review')`;
  return {
    activeStores: entries.active_stores, eligibleOrders: entries.orders, generatedCents: entries.generated,
    reversedCents: entries.reversed, paidCents: paid.cents, pendingCents: pending.cents, openCents: entries.open_cents,
  };
}
