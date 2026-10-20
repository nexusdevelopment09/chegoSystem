// Regras dos relatórios da loja. Funções puras.
//
// Fonte única: os indicadores, os gráficos e a listagem saem da MESMA lista de pedidos
// (carregada uma vez, com os filtros). Cada indicador é um "segmento" dessa lista: o
// número do cartão é a soma das linhas que a listagem do segmento mostra, por construção.

export type ReportOrder = {
  id: string;
  code: string;
  paidAt: Date;
  status: string;
  fulfillment: "delivery" | "pickup";
  paymentMethod: "pix" | "card" | "cash";
  /** "store": o cliente paga direto à loja; "app": pago pelo app, a loja recebe por repasse. */
  collection: "store" | "app";
  customerName: string;
  neighborhood: string | null;
  totalCents: number;
  refundedCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  /** Desconto que saiu do bolso da loja (cupom da própria loja). */
  storeDiscountCents: number;
  /** O que a loja recebe de um pedido pago pelo app (já sem comissão), antes dos reembolsos. */
  storeAmountCents: number;
  refundedFromStoreCents: number;
  acceptedAt: Date | null;
  readyAt: Date | null;
  /** Canal: pelo app, ou registrado na loja (mesa, balcão). */
  channel: "app" | "mesa" | "balcao";
  /** Soma dos produtos (antes de desconto e entrega). */
  subtotalCents: number;
  /** Itens vendidos (unidades). */
  itemsCount: number;
  /** Taxas do Chegô lançadas para o pedido (taxa menos estorno). */
  platformFeeCents: number;
  /** Custo estimado: saídas de estoque do pedido × custo cadastrado do item (null = sem custo cadastrado). */
  costCents: number | null;
};

const NOT_SOLD = new Set(["rejected", "cancelled", "refunded", "expired"]);
const COMPLETED = new Set(["delivered", "picked_up", "partially_refunded"]);
const IN_PROGRESS = new Set(["paid", "accepted", "preparing", "ready", "out_for_delivery"]);

/** Vendido: pago e não recusado, cancelado nem reembolsado por inteiro (a mesma regra de sempre). */
export const isSold = (order: ReportOrder) => !NOT_SOLD.has(order.status);
/** O que a venda vale: o total menos o que foi devolvido ao cliente. */
export const saleCents = (order: ReportOrder) => order.totalCents - order.refundedCents;

/** A divisão paga a loja dois dias úteis depois da venda (pagamentos pelo app). */
export function payoutDate(paidAt: Date): Date {
  const date = new Date(paidAt.getTime());
  let added = 0;
  while (added < 2) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = new Date(date.getTime() - 3 * 60 * 60 * 1000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return date;
}

/**
 * Quanto do pedido a loja ainda não recebeu, pela regra de cada forma de cobrança:
 * - pago direto à loja em dinheiro ou cartão: o cliente paga na entrega ou na retirada,
 *   então o pedido em andamento ainda está a receber; concluído, já foi recebido;
 * - pago direto à loja por Pix: o cliente paga o Pix da loja, fora do app. O Chegô não tem
 *   como saber se já caiu, então não conta como pendente (nem como recebido);
 * - pago pelo app: a loja recebe o repasse dois dias úteis depois da venda.
 * Recusado, cancelado e reembolsado nunca estão a receber.
 */
export function pendingCents(order: ReportOrder, at: Date): number {
  if (!isSold(order)) return 0;
  if (order.collection === "app") {
    const net = order.storeAmountCents - order.refundedFromStoreCents;
    return net > 0 && payoutDate(order.paidAt) > at ? net : 0;
  }
  return IN_PROGRESS.has(order.status) && order.paymentMethod !== "pix" ? saleCents(order) : 0;
}

/** Quanto do pedido a loja já recebeu, pela mesma regra. */
export function receivedCents(order: ReportOrder, at: Date): number {
  if (!isSold(order)) return 0;
  if (order.collection === "app") {
    const net = order.storeAmountCents - order.refundedFromStoreCents;
    return net > 0 && payoutDate(order.paidAt) <= at ? net : 0;
  }
  return COMPLETED.has(order.status) ? saleCents(order) : 0;
}

export type Segment = "vendidos" | "concluidos" | "andamento" | "cancelados" | "a_receber" | "recebidos" | "entrega" | "descontos" | "estornos" | "todos";

export type SegmentInfo = {
  label: string;
  /** O pedido entra na listagem deste segmento? */
  test: (order: ReportOrder, at: Date) => boolean;
  /** O valor de cada linha que o indicador soma (quando o indicador é dinheiro). */
  amount?: (order: ReportOrder, at: Date) => number;
};

export const SEGMENTS: Record<Segment, SegmentInfo> = {
  todos: { label: "Todos os pedidos recebidos", test: () => true },
  vendidos: { label: "Pedidos vendidos", test: isSold, amount: saleCents },
  concluidos: { label: "Pedidos concluídos (entregues ou retirados)", test: (order) => COMPLETED.has(order.status), amount: saleCents },
  andamento: { label: "Pedidos em andamento", test: (order) => IN_PROGRESS.has(order.status), amount: saleCents },
  cancelados: { label: "Recusados e cancelados", test: (order) => order.status === "rejected" || order.status === "cancelled", amount: (order) => order.totalCents },
  a_receber: { label: "A receber", test: (order, at) => pendingCents(order, at) > 0, amount: pendingCents },
  recebidos: { label: "Já recebidos", test: (order, at) => receivedCents(order, at) > 0, amount: receivedCents },
  entrega: { label: "Pedidos com taxa de entrega", test: (order) => isSold(order) && order.deliveryFeeCents > 0, amount: (order) => order.deliveryFeeCents },
  descontos: { label: "Pedidos com desconto", test: (order) => isSold(order) && order.discountCents > 0, amount: (order) => order.discountCents },
  estornos: { label: "Estornos e reembolsos", test: (order) => order.refundedCents > 0, amount: (order) => order.refundedCents },
};

export const isSegment = (value: string | undefined): value is Segment => value !== undefined && value in SEGMENTS;

/** As linhas de um segmento e o total que o indicador mostra (a soma dessas linhas). */
export function segmentRows(orders: ReportOrder[], segment: Segment, at: Date) {
  const info = SEGMENTS[segment];
  const rows = orders.filter((order) => info.test(order, at));
  const totalCents = info.amount ? rows.reduce((sum, order) => sum + info.amount!(order, at), 0) : 0;
  return { rows, count: rows.length, totalCents };
}

export type ReportSummary = {
  sold: { count: number; totalCents: number };
  ticketCents: number;
  completed: { count: number; totalCents: number };
  inProgress: { count: number; totalCents: number };
  cancelled: { count: number; totalCents: number };
  pending: { count: number; totalCents: number };
  received: { count: number; totalCents: number };
  deliveryFees: { count: number; totalCents: number };
  discounts: { count: number; totalCents: number };
  receivedOrders: number;
  refusalRate: number;
  avgAcceptMinutes: number | null;
  avgPrepMinutes: number | null;
  byDay: { day: string; count: number; totalCents: number }[];
  byHour: { hour: number; count: number }[];
};

const localParts = (date: Date) => {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
};

/** Todos os números da tela, calculados a partir das mesmas linhas da listagem. */
export function summarize(orders: ReportOrder[], at: Date): ReportSummary {
  const pick = (segment: Segment) => {
    const { count, totalCents } = segmentRows(orders, segment, at);
    return { count, totalCents };
  };
  const sold = orders.filter(isSold);
  const average = (values: number[]) => (values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
  const minutes = (from: Date | null, to: Date | null) => (from && to ? (to.getTime() - from.getTime()) / 60_000 : null);

  const days = new Map<string, { count: number; totalCents: number }>();
  const hours = new Map<number, number>();
  for (const order of sold) {
    const { day, hour } = localParts(order.paidAt);
    const entry = days.get(day) ?? { count: 0, totalCents: 0 };
    entry.count += 1;
    entry.totalCents += saleCents(order);
    days.set(day, entry);
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
  }
  const soldTotals = pick("vendidos");
  const cancelled = pick("cancelados");
  return {
    sold: soldTotals,
    ticketCents: soldTotals.count === 0 ? 0 : Math.round(soldTotals.totalCents / soldTotals.count),
    completed: pick("concluidos"),
    inProgress: pick("andamento"),
    cancelled,
    pending: pick("a_receber"),
    received: pick("recebidos"),
    deliveryFees: pick("entrega"),
    discounts: pick("descontos"),
    receivedOrders: orders.length,
    refusalRate: orders.length === 0 ? 0 : cancelled.count / orders.length,
    avgAcceptMinutes: average(sold.flatMap((order) => minutes(order.paidAt, order.acceptedAt) ?? [])),
    avgPrepMinutes: average(sold.flatMap((order) => minutes(order.acceptedAt, order.readyAt) ?? [])),
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, ...value })),
    byHour: [...hours.entries()].sort(([a], [b]) => a - b).map(([hour, count]) => ({ hour, count })),
  };
}

// ------------------------------------------------------------------ comparação e financeiro

const dayMs = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * O período anterior equivalente: hoje × ontem; 7 dias × os 7 anteriores; este mês × os
 * mesmos dias do mês anterior; este ano × os mesmos dias do ano anterior; personalizado ×
 * o mesmo número de dias logo antes.
 */
export function previousPeriod(from: string, to: string, preset: string): { from: string; to: string; label: string } {
  if (preset === "mes") {
    const [year, month, day] = to.split("-").map(Number);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const end = Math.min(day, lastDayOf(prevYear, prevMonth));
    const pad = (value: number) => String(value).padStart(2, "0");
    return { from: `${prevYear}-${pad(prevMonth)}-01`, to: `${prevYear}-${pad(prevMonth)}-${pad(end)}`, label: `mesmos dias do mês anterior (1 a ${end})` };
  }
  if (preset === "ano") {
    const back = (date: string) => {
      const [year, month, day] = date.split("-").map(Number);
      return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDayOf(year - 1, month))).padStart(2, "0")}`;
    };
    return { from: back(from), to: back(to), label: "mesmo período do ano anterior" };
  }
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs) + 1;
  const label = preset === "hoje" ? "ontem" : preset === "ontem" ? "anteontem" : days === 1 ? "dia anterior" : `${days} dias anteriores`;
  return { from: shift(from, -days), to: shift(from, -1), label };
}

export type Change = { pct: number | null; direction: "up" | "down" | "same" | "new" | "none" };

/** Variação percentual. Sem valor no período anterior não há percentual (seria enganoso). */
export function change(current: number, previous: number): Change {
  if (previous === 0) return { pct: null, direction: current === 0 ? "none" : "new" };
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "same" };
}

export type Financials = {
  /** Faturamento bruto: produtos + taxas de entrega dos pedidos vendidos, antes dos descontos. */
  grossCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  /** Reembolsos devolvidos aos clientes no período (inclui pedidos reembolsados por inteiro). */
  refundCents: number;
  /** Vendas: o que os clientes pagaram, já sem descontos e sem reembolsos. */
  salesCents: number;
  /** Taxas do Chegô (R$ 0,50 por pedido concluído, menos estornos). */
  platformFeeCents: number;
  /** Receita líquida operacional = vendas − taxas do Chegô. Não é lucro. */
  netOperatingCents: number;
  /** Custo estimado (saídas de estoque × custo cadastrado), só dos pedidos com custo conhecido. */
  costCents: number | null;
  /** Margem estimada = vendas dos pedidos com custo conhecido − custo estimado deles. */
  marginCents: number | null;
  itemsSold: number;
  byPayment: { method: "pix" | "card" | "cash"; count: number; totalCents: number }[];
  byChannel: { channel: string; count: number; totalCents: number }[];
};

export function financials(orders: ReportOrder[]): Financials {
  const sold = orders.filter(isSold);
  const sum = (list: ReportOrder[], pick: (order: ReportOrder) => number) => list.reduce((total, order) => total + pick(order), 0);
  const salesCents = sum(sold, saleCents);
  const platformFeeCents = sum(orders, (order) => order.platformFeeCents);
  const withCost = sold.filter((order) => order.costCents !== null);
  const costCents = withCost.length > 0 ? sum(withCost, (order) => order.costCents!) : null;
  const group = <K extends string>(key: (order: ReportOrder) => K) => {
    const map = new Map<K, { count: number; totalCents: number }>();
    for (const order of sold) {
      const entry = map.get(key(order)) ?? { count: 0, totalCents: 0 };
      entry.count += 1;
      entry.totalCents += saleCents(order);
      map.set(key(order), entry);
    }
    return [...map.entries()].sort((a, b) => b[1].totalCents - a[1].totalCents);
  };
  return {
    grossCents: sum(sold, (order) => order.subtotalCents + order.deliveryFeeCents),
    discountCents: sum(sold, (order) => order.discountCents),
    deliveryFeeCents: sum(sold, (order) => order.deliveryFeeCents),
    refundCents: sum(orders, (order) => order.refundedCents),
    salesCents,
    platformFeeCents,
    netOperatingCents: salesCents - platformFeeCents,
    costCents,
    marginCents: costCents === null ? null : sum(withCost, saleCents) - costCents,
    itemsSold: sum(sold, (order) => order.itemsCount),
    byPayment: group((order) => order.paymentMethod).map(([method, value]) => ({ method, ...value })),
    byChannel: group((order) => (order.channel === "app" ? order.fulfillment : order.channel)).map(([channel, value]) => ({ channel, ...value })),
  };
}

// ------------------------------------------------------------------ anual

export type YearMonth = { year: number; month: number; received: number; sold: number; completed: number; cancelled: number; salesCents: number; grossCents: number; discountCents: number; refundCents: number; items: number; feeCents: number };

export type YearSummary = {
  year: number;
  hasData: boolean;
  received: number; sold: number; completed: number; cancelled: number;
  salesCents: number; grossCents: number; discountCents: number; refundCents: number; items: number; feeCents: number;
  netOperatingCents: number; ticketCents: number;
  bestMonth: { month: number; salesCents: number } | null;
  worstMonth: { month: number; salesCents: number } | null;
  months: (YearMonth | null)[];
};

/** Totais de cada ano a partir das linhas por mês (meses sem pedido ficam como null, não zero). */
export function summarizeYears(rows: YearMonth[], years: number[]): YearSummary[] {
  return years.map((year) => {
    const list = rows.filter((row) => row.year === year);
    const sum = (pick: (row: YearMonth) => number) => list.reduce((total, row) => total + pick(row), 0);
    const withSales = list.filter((row) => row.sold > 0).sort((a, b) => b.salesCents - a.salesCents);
    const salesCents = sum((row) => row.salesCents);
    const sold = sum((row) => row.sold);
    const feeCents = sum((row) => row.feeCents);
    return {
      year, hasData: list.length > 0,
      received: sum((row) => row.received), sold, completed: sum((row) => row.completed), cancelled: sum((row) => row.cancelled),
      salesCents, grossCents: sum((row) => row.grossCents), discountCents: sum((row) => row.discountCents), refundCents: sum((row) => row.refundCents),
      items: sum((row) => row.items), feeCents, netOperatingCents: salesCents - feeCents, ticketCents: sold === 0 ? 0 : Math.round(salesCents / sold),
      bestMonth: withSales[0] ? { month: withSales[0].month, salesCents: withSales[0].salesCents } : null,
      worstMonth: withSales.length > 1 ? { month: withSales.at(-1)!.month, salesCents: withSales.at(-1)!.salesCents } : null,
      months: Array.from({ length: 12 }, (_, index) => list.find((row) => row.month === index + 1) ?? null),
    };
  });
}

/**
 * Ano incompleto: até onde dá para comparar sem enganar. Se algum ano escolhido é o ano
 * corrente, os outros são cortados no mesmo dia e mês de hoje (ex.: janeiro a 18/10 de cada ano).
 */
export function equivalentCutoff(years: number[], today: string): { month: number; day: number } | null {
  const [year, month, day] = today.split("-").map(Number);
  return years.includes(year) && years.length > 1 ? { month, day } : null;
}
