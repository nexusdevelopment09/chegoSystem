// Os cupons impressos pela impressora térmica. Funções puras: recebem o pedido já lido do
// banco (com as permissões de quem pediu) e devolvem os bytes ESC/POS.
import { quantityLabel } from "@/lib/catalog/weight";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { COLUMNS, Receipt, type Encoding } from "./escpos";

export type PrintKind = "completo" | "cozinha" | "comprovante";

export const PRINT_KIND_LABELS: Record<PrintKind | "teste", string> = {
  completo: "Pedido completo",
  cozinha: "Comanda da cozinha",
  comprovante: "Comprovante do cliente",
  teste: "Teste",
};

/** O que o cupom precisa do pedido (um recorte de OrderView). */
export type ReceiptOrder = {
  code: string;
  createdAt: Date;
  fulfillment: "delivery" | "pickup";
  scheduledFor: Date | null;
  customerName: string;
  customerPhone: string | null;
  address: { street: string; number: string; neighborhood: string; reference: string | null; complement: string | null } | null;
  requiresAgeCheck: boolean;
  notes: string | null;
  items: { name: string; quantity: number; weightStepGrams: number | null; lineTotalCents: number; notes: string | null; lines: string[]; removed: boolean }[];
  totals: { subtotalCents: number; discountCents: number; deliveryFeeCents: number; serviceFeeCents: number; totalCents: number };
  refundedCents: number;
  paymentMethod: "pix" | "card" | "cash";
  paymentCollection: "app" | "store";
  cashChangeForCents: number | null;
};

export type ReceiptOptions = { storeName: string; kind: PrintKind; width: 58 | 80; encoding: Encoding; copy?: { index: number; total: number } };

const PAYMENT = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;

/** Forma de pagamento e troco, como a loja precisa saber na hora de entregar. */
function paymentLines(order: ReceiptOrder): string[] {
  if (order.paymentCollection === "app") return [`Pago pelo app (${PAYMENT[order.paymentMethod]})`];
  const lines = [`Pagamento: ${PAYMENT[order.paymentMethod]}${order.paymentMethod === "pix" ? " (Pix da loja)" : " na entrega"}`];
  if (order.paymentMethod === "cash") {
    lines.push(order.cashChangeForCents ? `Troco para ${formatCents(order.cashChangeForCents)} (levar ${formatCents(order.cashChangeForCents - order.totals.totalCents)})` : "Sem troco");
  }
  return lines;
}

export function buildReceipt(order: ReceiptOrder, options: ReceiptOptions): Uint8Array {
  const r = new Receipt(options.width, options.encoding);
  const kitchen = options.kind === "cozinha";
  const items = order.items.filter((item) => !item.removed);

  if (options.copy && options.copy.total > 1) r.text(`Via ${options.copy.index} de ${options.copy.total}`, { align: "right" });
  if (kitchen) {
    r.text("COZINHA", { align: "center", bold: true });
  } else {
    r.text(options.storeName, { align: "center", bold: true });
  }
  r.text(`Pedido ${order.code}`, { align: "center", bold: true, size: "double" });
  r.text(formatDateTime(order.createdAt), { align: "center" });
  r.separator();

  r.text(order.fulfillment === "delivery" ? "ENTREGA" : "RETIRADA NO BALCÃO", { bold: true, size: kitchen ? "double" : "normal" });
  if (order.scheduledFor) r.text(`AGENDADO: ${formatDateTime(order.scheduledFor)}`, { bold: true });
  r.text(order.customerName);
  if (!kitchen) {
    if (order.customerPhone) r.text(formatPhone(order.customerPhone));
    if (order.address) {
      r.text(`${order.address.street}, ${order.address.number}`);
      r.text(order.address.neighborhood, { bold: true });
      if (order.address.reference) r.text(`Ref: ${order.address.reference}`);
      if (order.address.complement) r.text(`Compl: ${order.address.complement}`);
    }
  }
  if (order.requiresAgeCheck && !kitchen) r.text("CONFERIR DOCUMENTO NA ENTREGA", { bold: true, align: "center" });
  r.separator();

  for (const item of items) {
    const name = `${quantityLabel(item.quantity, item.weightStepGrams)} ${item.name}`;
    if (kitchen) r.text(name, { bold: true });
    else r.row(name, formatCents(item.lineTotalCents), { bold: true });
    // Sabores, tamanho, adicionais e complementos.
    for (const line of item.lines) r.text(`  ${line}`);
    if (item.notes) r.text(`  Obs: ${item.notes}`, { bold: kitchen });
  }
  if (order.notes) r.text(`Obs do pedido: ${order.notes}`, { bold: true });

  if (!kitchen) {
    r.separator();
    r.row("Subtotal", formatCents(order.totals.subtotalCents));
    if (order.totals.discountCents > 0) r.row("Desconto", `- ${formatCents(order.totals.discountCents)}`);
    if (order.totals.deliveryFeeCents > 0) r.row("Taxa de entrega", formatCents(order.totals.deliveryFeeCents));
    if (order.totals.serviceFeeCents > 0) r.row("Taxa de serviço", formatCents(order.totals.serviceFeeCents));
    r.row("TOTAL", formatCents(order.totals.totalCents), { bold: true });
    if (order.refundedCents > 0) r.row("Devolvido", `- ${formatCents(order.refundedCents)}`);
    r.separator();
    for (const line of paymentLines(order)) r.text(line, { bold: true });
  }
  if (options.kind === "comprovante") {
    r.feed(1);
    r.text("Obrigado pela preferência!", { align: "center" });
    r.text("Pedido feito pelo Chegô", { align: "center" });
  }
  return r.cut().toBytes();
}

/** Várias vias do mesmo cupom, uma depois da outra. */
export function buildCopies(order: ReceiptOrder, options: Omit<ReceiptOptions, "copy">, copies: number): Uint8Array {
  const parts = Array.from({ length: copies }, (_, index) => buildReceipt(order, { ...options, copy: { index: index + 1, total: copies } }));
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { all.set(part, offset); offset += part.length; }
  return all;
}

/** Cupom de teste: nome da loja e da impressora, largura, régua de colunas e os acentos. */
export function buildTestReceipt(input: { storeName: string; printerName: string; width: 58 | 80; encoding: Encoding; at: Date }): Uint8Array {
  const r = new Receipt(input.width, input.encoding);
  const columns = COLUMNS[input.width];
  r.text("TESTE DE IMPRESSÃO", { align: "center", bold: true, size: "double" });
  r.text(input.storeName, { align: "center", bold: true });
  r.text(`Impressora: ${input.printerName}`, { align: "center" });
  r.text(`Papel de ${input.width} mm (${columns} colunas)`, { align: "center" });
  r.text(formatDateTime(input.at), { align: "center" });
  r.separator();
  r.text("1234567890".repeat(Math.ceil(columns / 10)).slice(0, columns));
  r.text("Acentos: á é í ó ú â ê ô ã õ à ç");
  r.text("ÁÉÍÓÚ ÂÊÔ ÃÕ À Ç  ª º");
  r.text("Coração, pão, feijão, açaí, maçã.");
  r.row("Pizza Grande (8 fatias)", formatCents(5200));
  r.row("TOTAL", formatCents(5200), { bold: true });
  r.separator();
  r.text("Se os acentos saíram trocados, mude a tabela de caracteres da impressora no Chegô.", { align: "center" });
  return r.cut().toBytes();
}
