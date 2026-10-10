// A máquina de estados do pedido: o único lugar que diz qual status pode vir depois
// de qual, e quem pode fazer a mudança. Funções puras.

export type OrderStatus =
  | "awaiting_payment" | "paid" | "accepted" | "preparing" | "ready"
  | "out_for_delivery" | "delivered" | "picked_up"
  | "expired" | "rejected" | "cancelled" | "refunded" | "partially_refunded";

/** Quem está pedindo a mudança. "staff" = dono ou atendente da loja. */
export type Actor = "system" | "customer" | "staff" | "courier" | "admin";
export type Fulfillment = "delivery" | "pickup";

type Rule = { to: OrderStatus; by: Actor[]; only?: Fulfillment };

const RULES: Record<OrderStatus, Rule[]> = {
  awaiting_payment: [
    { to: "paid", by: ["system"] },
    { to: "expired", by: ["system"] },
    { to: "cancelled", by: ["customer", "admin"] },
  ],
  paid: [
    { to: "accepted", by: ["staff"] },
    { to: "rejected", by: ["staff", "system"] },
    { to: "cancelled", by: ["customer", "admin"] },
  ],
  accepted: [
    { to: "preparing", by: ["staff"] },
    { to: "cancelled", by: ["admin"] },
  ],
  preparing: [
    { to: "ready", by: ["staff"] },
    { to: "cancelled", by: ["admin"] },
  ],
  ready: [
    { to: "out_for_delivery", by: ["staff"], only: "delivery" },
    { to: "picked_up", by: ["staff"], only: "pickup" },
    { to: "cancelled", by: ["admin"] },
  ],
  out_for_delivery: [
    { to: "delivered", by: ["courier", "staff", "admin"], only: "delivery" },
    { to: "cancelled", by: ["admin"] },
  ],
  delivered: [
    { to: "refunded", by: ["admin"] },
    { to: "partially_refunded", by: ["admin", "system"] },
  ],
  picked_up: [
    { to: "refunded", by: ["admin"] },
    { to: "partially_refunded", by: ["admin", "system"] },
  ],
  partially_refunded: [
    { to: "refunded", by: ["admin"] },
    { to: "partially_refunded", by: ["admin"] },
  ],
  expired: [],
  rejected: [],
  cancelled: [],
  refunded: [],
};

export const ALL_STATUSES = Object.keys(RULES) as OrderStatus[];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor, fulfillment: Fulfillment): boolean {
  return RULES[from].some(
    (rule) => rule.to === to && rule.by.includes(actor) && (!rule.only || rule.only === fulfillment),
  );
}

/** Status para os quais este autor pode levar o pedido a partir de onde ele está. */
export function nextStatuses(from: OrderStatus, actor: Actor, fulfillment: Fulfillment): OrderStatus[] {
  return RULES[from]
    .filter((rule) => rule.by.includes(actor) && (!rule.only || rule.only === fulfillment))
    .map((rule) => rule.to);
}

/** Depois destes, nada mais acontece sozinho com o pedido. */
export const isFinal = (status: OrderStatus) => RULES[status].length === 0 || status === "delivered" || status === "picked_up" || status === "partially_refunded";

/** A loja ainda está trabalhando nele. */
export const IN_PROGRESS: OrderStatus[] = ["paid", "accepted", "preparing", "ready", "out_for_delivery"];

/** Status que devolvem o estoque reservado e o cupom. */
export const RELEASES_STOCK: OrderStatus[] = ["expired", "rejected", "cancelled"];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago, esperando a loja aceitar",
  accepted: "Aceito pela loja",
  preparing: "Em preparo",
  ready: "Pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  picked_up: "Retirado",
  expired: "Pagamento expirado",
  rejected: "Recusado pela loja",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  partially_refunded: "Reembolsado em parte",
};

/** O que o cliente fica sabendo quando o pedido chega a cada status. */
export const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  accepted: { title: "A loja aceitou seu pedido", body: "Já já começa o preparo." },
  preparing: { title: "Seu pedido está sendo preparado", body: "Tá saindo do forno!" },
  ready: { title: "Seu pedido está pronto", body: "Se for retirada, é só passar no balcão." },
  out_for_delivery: { title: "Seu pedido saiu!", body: "Já já chega aí." },
  delivered: { title: "Pedido entregue", body: "Bom proveito! Depois conta pra gente como foi." },
  picked_up: { title: "Pedido retirado", body: "Bom proveito! Depois conta pra gente como foi." },
  rejected: { title: "Eita, a loja não pôde aceitar seu pedido", body: "O valor já foi devolvido para você." },
  cancelled: { title: "Pedido cancelado", body: "Se você já tinha pago, o valor foi devolvido." },
  expired: { title: "O prazo do pagamento acabou", body: "Seu pedido não foi enviado para a loja. É só pedir de novo." },
  refunded: { title: "Reembolso feito", body: "Devolvemos o valor do seu pedido." },
  partially_refunded: { title: "Reembolso parcial feito", body: "Devolvemos parte do valor do seu pedido." },
};

export const REJECT_REASONS = ["Item esgotado", "Loja muito cheia", "Fora da área de entrega", "Outro"] as const;
