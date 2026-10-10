// Planilha do cardápio (CSV) para lojas com muitos produtos. Funções puras.
// Formato: separado por ponto e vírgula, do jeito que o Excel no Brasil salva.
import { parseMoney } from "../format.ts";

export const CSV_HEADER = ["secao", "nome", "descricao", "preco", "disponivel", "estoque"] as const;

export type CsvProduct = {
  section: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
  /** Null = estoque não controlado. */
  stock: number | null;
};

export type CsvResult = { products: CsvProduct[]; errors: string[] };

/** Divide uma linha do CSV, respeitando campos entre aspas ("a;b" e aspas dobradas). */
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { cells.push(cell); cell = ""; }
    else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

export function parseMenuCsv(text: string): CsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { products: [], errors: ["A planilha está vazia."] };

  const separator = lines[0].includes(";") ? ";" : ",";
  const header = splitLine(lines[0], separator).map((cell) => cell.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const column = (name: string) => header.indexOf(name);
  for (const required of ["nome", "preco"]) {
    if (column(required) === -1) return { products: [], errors: [`Falta a coluna “${required}” na primeira linha.`] };
  }

  const products: CsvProduct[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  lines.slice(1).forEach((line, index) => {
    const row = index + 2;
    const cells = splitLine(line, separator);
    const get = (name: string) => (column(name) === -1 ? "" : cells[column(name)] ?? "");

    const name = get("nome");
    const priceCents = parseMoney(get("preco"));
    const stockText = get("estoque");
    const stock = stockText === "" ? null : Number(stockText);
    const section = get("secao") || "Outros";

    if (!name) return void errors.push(`Linha ${row}: falta o nome do produto.`);
    if (name.length > 120) return void errors.push(`Linha ${row}: nome muito comprido.`);
    if (priceCents === null) return void errors.push(`Linha ${row}: preço inválido (“${get("preco")}”). Use o formato 12,50.`);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return void errors.push(`Linha ${row}: estoque inválido (“${stockText}”).`);
    const key = `${section}|${name}`.toLowerCase();
    if (seen.has(key)) return void errors.push(`Linha ${row}: “${name}” aparece duas vezes na seção ${section}.`);
    seen.add(key);

    const availableText = get("disponivel").toLowerCase();
    products.push({
      section, name, description: get("descricao"), priceCents, stock,
      available: !["nao", "não", "n", "0", "false"].includes(availableText),
    });
  });

  return { products, errors };
}

const quote = (value: string) => (/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Com a marca de ordem de bytes (BOM), para o Excel abrir os acentos certo. */
export function toMenuCsv(products: CsvProduct[]): string {
  const rows = products.map((product) => [
    product.section, product.name, product.description,
    (product.priceCents / 100).toFixed(2).replace(".", ","),
    product.available ? "sim" : "nao",
    product.stock === null ? "" : String(product.stock),
  ].map(quote).join(";"));
  return `﻿${[CSV_HEADER.join(";"), ...rows].join("\r\n")}\r\n`;
}

/** Preço novo depois de uma mudança percentual, arredondado ao centavo e nunca abaixo de zero. */
export function adjustPrice(priceCents: number, percent: number): number {
  return Math.max(0, Math.round(priceCents * (1 + percent / 100)));
}
