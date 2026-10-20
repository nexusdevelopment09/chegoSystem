import { describe, expect, it } from "vitest";
import { COLUMNS, encodeText, plain, twoColumns, wrap } from "./escpos";
import { buildCopies, buildReceipt, buildTestReceipt, type ReceiptOrder } from "./receipt";

// Decodifica os bytes de volta em texto (CP860), ignorando os comandos ESC/GS, para conferir o cupom.
const CP860_BACK: Record<number, string> = { 0x87: "ç", 0x84: "ã", 0x82: "é", 0xa0: "á", 0x80: "Ç", 0x8e: "Ã", 0x94: "õ", 0xa2: "ó", 0x83: "â", 0x88: "ê", 0x93: "ô", 0xa1: "í", 0xa3: "ú", 0x85: "à" };
function readable(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let line = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0x1b) { i += bytes[i + 1] === 0x40 ? 1 : 2; continue; } // ESC @ / ESC x n
    if (byte === 0x1d) { i += bytes[i + 1] === 0x56 ? 3 : 2; continue; } // GS V m n / GS ! n
    if (byte === 0x0a) { out.push(line); line = ""; continue; }
    line += CP860_BACK[byte] ?? String.fromCharCode(byte);
  }
  return out;
}

const order: ReceiptOrder = {
  code: "JG-0402", createdAt: new Date("2026-10-09T19:30:00-03:00"), fulfillment: "delivery", scheduledFor: null,
  customerName: "Ana Clara Souza", customerPhone: "+5582999990000",
  address: { street: "Rua São João", number: "12", neighborhood: "Casal", reference: "Casa azul depois da ponte", complement: null },
  requiresAgeCheck: false, notes: "Tocar a campainha",
  items: [
    { name: "Pizza Grande (8 fatias)", quantity: 1, weightStepGrams: null, lineTotalCents: 5600, notes: "Sem cebola", lines: ["Sabores: 1/2 Calabresa, 1/2 Carne de sol", "Borda: Catupiry"], removed: false },
    { name: "Granola a granel", quantity: 41, weightStepGrams: 10, lineTotalCents: 1636, notes: null, lines: [], removed: false },
    { name: "Refrigerante 2 L", quantity: 1, weightStepGrams: null, lineTotalCents: 1200, notes: null, lines: [], removed: true },
  ],
  totals: { subtotalCents: 7236, discountCents: 500, deliveryFeeCents: 300, serviceFeeCents: 0, totalCents: 7036 },
  refundedCents: 0, paymentMethod: "cash", paymentCollection: "store", cashChangeForCents: 10000,
};

describe("impressão: ESC/POS", () => {
  it("acentos e cedilha na tabela da impressora (CP860 e CP850) ou sem acento", () => {
    expect(encodeText("ção", "cp860")).toEqual([0x87, 0x84, 0x6f]);
    expect(encodeText("ção", "cp850")).toEqual([0x87, 0xc6, 0x6f]);
    expect(encodeText("ção", "ascii")).toEqual([0x63, 0x61, 0x6f]);
    expect(plain("Pão — “ótimo”…")).toBe('Pao - "otimo"...');
    // O espaço do Intl ("R$ 10,00") vira espaço comum, não "?".
    expect(encodeText("R$ 10,00", "cp860")).toEqual([...Buffer.from("R$ 10,00")]);
    expect(encodeText("😀", "cp860")).toEqual([0x3f, 0x3f]);
  });

  it("quebra linhas sem cortar palavras e alinha o valor à direita", () => {
    expect(wrap("Pizza Grande de calabresa com borda recheada", 16)).toEqual(["Pizza Grande de", "calabresa com", "borda recheada"]);
    expect(wrap("Supercalifragilisticexpialidocious", 10)).toEqual(["Supercalif", "ragilistic", "expialidoc", "ious"]);
    const lines = twoColumns("1x Pizza Grande de calabresa com borda", "R$ 52,00", 32);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    expect(lines.at(-1)!.endsWith("R$ 52,00")).toBe(true);
  });

  it("pedido completo de 58 mm: tudo do pedido, nada passa de 32 colunas, item removido fora", () => {
    const text = readable(buildReceipt(order, { storeName: "Pizzaria Forno de Barro", kind: "completo", width: 58, encoding: "cp860" }));
    for (const line of text) expect(line.length, line).toBeLessThanOrEqual(COLUMNS[58]);
    // Linhas quebradas na largura viram um texto só, para procurar frases inteiras.
    const all = text.join(" ").replace(/\s+/g, " ");
    for (const expected of ["Pizzaria Forno de Barro", "Pedido JG-0402", "ENTREGA", "Ana Clara Souza", "(82) 99999-0000", "Rua São João, 12", "Casal",
      "Ref: Casa azul depois da ponte", "Sabores: 1/2 Calabresa", "Borda: Catupiry", "Obs: Sem cebola", "410 g Granola a granel", "R$ 16,36",
      "Obs do pedido: Tocar a campainha", "Subtotal", "R$ 72,36", "Desconto", "- R$ 5,00", "Taxa de entrega", "R$ 3,00", "TOTAL", "R$ 70,36",
      "Pagamento: Dinheiro na entrega", "Troco para R$ 100,00 (levar R$ 29,64)"]) {
      expect(all, expected).toContain(expected);
    }
    expect(all).not.toContain("Refrigerante");
  });

  it("comanda da cozinha: produtos, sabores e observações, sem valores nem endereço", () => {
    const all = readable(buildReceipt(order, { storeName: "Pizzaria", kind: "cozinha", width: 58, encoding: "cp860" })).join("\n");
    expect(all).toContain("COZINHA");
    expect(all).toContain("Pedido JG-0402");
    expect(all).toContain("Sabores: 1/2 Calabresa");
    expect(all).toContain("Obs: Sem cebola");
    expect(all).toContain("ENTREGA");
    expect(all).not.toMatch(/R\$/);
    expect(all).not.toContain("Rua São João");
    expect(all).not.toContain("99999");
  });

  it("várias vias e cupom de teste", () => {
    const two = readable(buildCopies(order, { storeName: "Pizzaria", kind: "completo", width: 80, encoding: "cp860" }, 2)).join("\n");
    expect(two).toContain("Via 1 de 2");
    expect(two).toContain("Via 2 de 2");
    const test = readable(buildTestReceipt({ storeName: "Pizzaria", printerName: "Caixa", width: 58, encoding: "cp860", at: new Date("2026-10-09T15:00:00-03:00") })).join(" ").replace(/\s+/g, " ");
    expect(test).toContain("Impressora: Caixa");
    expect(test).toContain("Papel de 58 mm (32 colunas)");
    expect(test).toContain("Coração, pão, feijão, açaí, maçã.");
  });
});
