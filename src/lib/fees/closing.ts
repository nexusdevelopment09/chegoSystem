import "server-only";
import { sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addDays, businessDate, closingTotals, type FeeEntryKind } from "./rules";

export type ClosingStatus = "awaiting_payment" | "paid" | "overdue" | "in_review";

export type Closing = {
  id: string; store_id: string; business_date: string; status: ClosingStatus; order_count: number;
  fees_cents: number; credits_cents: number; adjustments_cents: number; total_due_cents: number;
  fee_unit_cents: number; due_date: string; closed_at: Date; paid_at: Date | null; review_reason: string | null;
};

export type CloseResult = { closing: Closing; created: boolean } | { closing: null; reason: string };

const CLOSING_COLUMNS = sql`
  id, store_id, business_date::text, status, order_count, fees_cents, credits_cents, adjustments_cents,
  total_due_cents, fee_unit_cents, due_date::text, closed_at, paid_at, review_reason`;

/**
 * Fecha o expediente de uma loja: junta todos os lançamentos ainda abertos até aquele
 * dia num fechamento, com o total a pagar ao Chegô.
 *
 * - Idempotente: fechar de novo o mesmo dia (clique duplo, página recarregada, tarefa
 *   automática junto com a loja) devolve o fechamento que já existe.
 * - Nada é contado duas vezes: cada lançamento entra num único fechamento.
 * - Saldo negativo (créditos de cupom maiores que as taxas) não vira cobrança: o crédito
 *   passa para o próximo fechamento, com um lançamento de cada lado.
 */
export async function closeBusinessDay(input: { storeId: string; businessDate: string; at: Date; closedBy: string | null }): Promise<CloseResult> {
  const settings = await getSettings();
  return sql.begin(async (tx): Promise<CloseResult> => {
    // Um fechamento por vez por loja.
    await tx`select id from stores where id = ${input.storeId} for update`;

    const [existing] = await tx<Closing[]>`
      select ${CLOSING_COLUMNS} from store_closings where store_id = ${input.storeId} and business_date = ${input.businessDate}`;
    if (existing) return { closing: existing, created: false };

    const entries = await tx<{ id: string; kind: FeeEntryKind; amount_cents: number }[]>`
      select id, kind, amount_cents from fee_entries
      where store_id = ${input.storeId} and closing_id is null and business_date <= ${input.businessDate}
      for update`;
    if (entries.length === 0) return { closing: null, reason: "Não há pedidos nem lançamentos em aberto para fechar." };

    const totals = closingTotals(entries.map((entry) => ({ kind: entry.kind, amountCents: entry.amount_cents })));
    const credit = totals.netCents < 0 ? -totals.netCents : 0;
    const due = Math.max(totals.netCents, 0);
    const today = businessDate(input.at, settings.business_day_cutoff_hour);

    const [closing] = await tx<Closing[]>`
      insert into store_closings (store_id, business_date, status, order_count, fees_cents, credits_cents, adjustments_cents,
                                  total_due_cents, fee_unit_cents, due_date, closed_at, closed_by, paid_at)
      values (${input.storeId}, ${input.businessDate}, ${due === 0 ? "paid" : "awaiting_payment"}::closing_status,
              ${totals.orderCount}, ${totals.feesCents}, ${totals.creditsCents}, ${totals.adjustmentsCents + credit},
              ${due}, ${settings.order_fee_cents}, ${addDays(today, settings.fee_due_days)}, ${input.at}, ${input.closedBy},
              ${due === 0 ? input.at : null})
      returning ${CLOSING_COLUMNS}`;

    await tx`update fee_entries set closing_id = ${closing.id} where id = any(${entries.map((entry) => entry.id)}::uuid[])`;

    if (credit > 0) {
      await tx`
        insert into fee_entries (store_id, kind, amount_cents, business_date, closing_id, carried_from_closing_id, reason, created_at) values
          (${input.storeId}, 'carryover', ${credit}, ${input.businessDate}, ${closing.id}, null, 'Crédito levado para o próximo fechamento', ${input.at}),
          (${input.storeId}, 'carryover', ${-credit}, ${input.businessDate}, null, ${closing.id}, 'Crédito trazido do fechamento anterior', ${input.at})`;
    }
    return { closing, created: true };
  }) as Promise<CloseResult>;
}

/** Dia de expediente em andamento agora, conforme a hora de corte configurada. */
export async function currentBusinessDate(at: Date): Promise<string> {
  const settings = await getSettings();
  return businessDate(at, settings.business_day_cutoff_hour);
}

export type FeeSummary = {
  today: string;
  /** Pedidos concluídos no expediente de hoje (com taxa). */
  todayOrders: number;
  todayFeesCents: number;
  /** Lançamentos ainda não fechados, de qualquer dia (inclusive créditos trazidos). */
  openCents: number;
  /** Fechamentos ainda não pagos. */
  dueCents: number;
  lastClosing: Closing | null;
  lastPayment: { amount_cents: number; received_at: Date } | null;
  nextDueDate: string | null;
};

/** O resumo da conta de uma loja com o Chegô, para o painel da loja e o admin. */
export async function feeSummary(storeId: string, at: Date): Promise<FeeSummary> {
  const today = await currentBusinessDate(at);
  const [[open], [due], [lastClosing], [lastPayment]] = await Promise.all([
    sql<{ today_orders: number; today_fees: number; open_cents: number }[]>`
      select
        coalesce(sum(case when kind = 'order_fee' then 1 when kind = 'order_fee_reversal' then -1 else 0 end)
          filter (where business_date = ${today}), 0)::int as today_orders,
        coalesce(sum(amount_cents) filter (where business_date = ${today} and kind in ('order_fee', 'order_fee_reversal')), 0)::int as today_fees,
        coalesce(sum(amount_cents), 0)::int as open_cents
      from fee_entries where store_id = ${storeId} and closing_id is null`,
    sql<{ due_cents: number; next_due: string | null }[]>`
      select coalesce(sum(total_due_cents), 0)::int as due_cents, min(due_date)::text as next_due
      from store_closings where store_id = ${storeId} and status in ('awaiting_payment', 'overdue', 'in_review')`,
    sql<Closing[]>`select ${CLOSING_COLUMNS} from store_closings where store_id = ${storeId} order by business_date desc limit 1`,
    sql<{ amount_cents: number; received_at: Date }[]>`
      select p.amount_cents, p.received_at from fee_payments p join fee_charges c on c.id = p.charge_id
      where c.store_id = ${storeId} and p.applied order by p.received_at desc limit 1`,
  ]);
  return {
    today, todayOrders: open.today_orders, todayFeesCents: open.today_fees, openCents: open.open_cents,
    dueCents: due.due_cents, lastClosing: lastClosing ?? null, lastPayment: lastPayment ?? null, nextDueDate: due.next_due,
  };
}

export async function loadClosing(id: string): Promise<Closing | null> {
  const [closing] = await sql<Closing[]>`select ${CLOSING_COLUMNS} from store_closings where id = ${id}`;
  return closing ?? null;
}

export async function listClosings(filter: { storeId?: string; status?: ClosingStatus; limit?: number }): Promise<(Closing & { store_name: string })[]> {
  return sql<(Closing & { store_name: string })[]>`
    select ${sql`c.id, c.store_id, c.business_date::text, c.status, c.order_count, c.fees_cents, c.credits_cents, c.adjustments_cents,
      c.total_due_cents, c.fee_unit_cents, c.due_date::text, c.closed_at, c.paid_at, c.review_reason`}, s.name as store_name
    from store_closings c join stores s on s.id = c.store_id
    where true
      ${filter.storeId ? sql`and c.store_id = ${filter.storeId}` : sql``}
      ${filter.status ? sql`and c.status = ${filter.status}::closing_status` : sql``}
    order by c.business_date desc, s.name
    limit ${filter.limit ?? 60}`;
}

/** Os lançamentos de um fechamento (ou os ainda abertos), com o pedido de cada um. */
export async function closingEntries(filter: { closingId: string } | { storeId: string; open: true }) {
  return sql<{ id: string; kind: FeeEntryKind; amount_cents: number; business_date: string; order_id: string | null; order_code: string | null; reason: string | null; created_at: Date }[]>`
    select e.id, e.kind, e.amount_cents, e.business_date::text, e.order_id, o.code as order_code, e.reason, e.created_at
    from fee_entries e left join orders o on o.id = e.order_id
    where ${"closingId" in filter ? sql`e.closing_id = ${filter.closingId}` : sql`e.store_id = ${filter.storeId} and e.closing_id is null`}
    order by e.created_at`;
}

/**
 * Tarefa diária: fecha sozinho os expedientes que já terminaram e ficaram abertos (a loja
 * não clicou em "Fechar expediente"), e marca como vencidos os fechamentos não pagos.
 */
export async function runDailyFeeTasks(at: Date): Promise<{ closed: number; overdue: number }> {
  const today = await currentBusinessDate(at);
  // Fecha sempre "até ontem". Se a loja já fechou ontem na mão e um pedido de ontem foi
  // concluído depois, esse lançamento entra no fechamento seguinte (nunca fica esquecido).
  const yesterday = addDays(today, -1);
  const pending = await sql<{ store_id: string }[]>`
    select distinct store_id from fee_entries where closing_id is null and business_date < ${today}`;
  let closed = 0;
  for (const row of pending) {
    const result = await closeBusinessDay({ storeId: row.store_id, businessDate: yesterday, at, closedBy: null });
    if (result.closing && result.created) closed += 1;
  }
  const overdue = await sql`
    update store_closings set status = 'overdue'
    where status = 'awaiting_payment' and due_date < ${today}::date returning id`;
  return { closed, overdue: overdue.length };
}
