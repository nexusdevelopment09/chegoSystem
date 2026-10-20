// Comandos ESC/POS para mini impressoras térmicas (58 mm = 32 colunas na fonte A; 80 mm =
// 48 colunas). Funções puras: montam os bytes; quem envia é o celular, pelo Bluetooth.

export type Encoding = "cp860" | "cp850" | "ascii";

const ESC = 0x1b;
const GS = 0x1d;

/** Colunas da fonte A em cada largura de papel. */
export const COLUMNS: Record<58 | 80, number> = { 58: 32, 80: 48 };

/** Número da tabela de caracteres no comando ESC t (padrão Epson, seguido pela maioria). */
const CODE_PAGE: Record<Exclude<Encoding, "ascii">, number> = { cp850: 2, cp860: 3 };

// Só os caracteres que o português usa (e alguns vizinhos); o resto é ASCII.
const CP860: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ã": 0x84, "à": 0x85, "Á": 0x86, "ç": 0x87, "ê": 0x88, "Ê": 0x89,
  "è": 0x8a, "Í": 0x8b, "Ô": 0x8c, "ì": 0x8d, "Ã": 0x8e, "Â": 0x8f, "É": 0x90, "À": 0x91, "È": 0x92, "ô": 0x93,
  "õ": 0x94, "ò": 0x95, "Ú": 0x96, "ù": 0x97, "Ì": 0x98, "Õ": 0x99, "Ü": 0x9a, "Ù": 0x9d, "Ó": 0x9f, "á": 0xa0,
  "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ª": 0xa6, "º": 0xa7, "Ò": 0xa9,
};
const CP850: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "à": 0x85, "ç": 0x87, "ê": 0x88, "è": 0x8a, "É": 0x90, "ô": 0x93,
  "ò": 0x95, "ù": 0x97, "Ü": 0x9a, "á": 0xa0, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ª": 0xa6,
  "º": 0xa7, "Á": 0xb5, "Â": 0xb6, "À": 0xb7, "ã": 0xc6, "Ã": 0xc7, "Ê": 0xd2, "Í": 0xd6, "Ó": 0xe0, "Ô": 0xe2,
  "Ò": 0xe3, "õ": 0xe4, "Õ": 0xe5, "Ú": 0xe9, "Ù": 0xeb,
};
const TABLES: Record<Exclude<Encoding, "ascii">, Record<string, number>> = { cp850: CP850, cp860: CP860 };

/** Espaços especiais, travessões, aspas curvas e reticências viram os equivalentes simples. */
const normalizeSymbols = (text: string) => text.replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[\u2013\u2014]/g, "-").replace(/[\u201c\u201d\u00ab\u00bb]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\u2026/g, "...").replace(/\u00d7/g, "x");

/** Tira acentos e troca o que a impressora não tem (travessão, aspas curvas, emoji...). */
export function plain(text: string): string {
  return normalizeSymbols(text)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

/** Texto em bytes na tabela da impressora. O que não existe na tabela vira a letra sem acento. */
export function encodeText(text: string, encoding: Encoding): number[] {
  const bytes: number[] = [];
  const table = encoding === "ascii" ? null : TABLES[encoding];
  for (const char of normalizeSymbols(text)) {
    const code = char.charCodeAt(0);
    if (char === "\n" || (code >= 0x20 && code <= 0x7e)) bytes.push(code);
    else if (table?.[char] !== undefined) bytes.push(table[char]);
    else for (const fallback of plain(char)) bytes.push(fallback.charCodeAt(0));
  }
  return bytes;
}

/** Quebra o texto em linhas de até `width` colunas, sem cortar palavras (só as maiores que a linha). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > width) {
        if (line) { lines.push(line); line = ""; }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!rest) continue;
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= width) line += ` ${rest}`;
      else { lines.push(line); line = rest; }
    }
    lines.push(line);
  }
  return lines;
}

/** "2x Pizza Grande .......... R$ 52,00": nome à esquerda (quebrando), valor à direita. */
export function twoColumns(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  if (room < 8) return [...wrap(left, width), right.padStart(width)];
  const lines = wrap(left, room);
  const last = lines.pop() ?? "";
  return [...lines, `${last.padEnd(room)} ${right}`];
}

type Style = { bold?: boolean; align?: "left" | "center" | "right"; size?: "normal" | "double" };

/** Monta um cupom: texto com estilos, separadores, alimentação de papel e corte. */
export class Receipt {
  private readonly bytes: number[] = [];

  constructor(readonly width: 58 | 80, readonly encoding: Encoding) {
    this.bytes.push(ESC, 0x40); // inicializa
    if (encoding !== "ascii") this.bytes.push(ESC, 0x74, CODE_PAGE[encoding]);
  }

  get columns() {
    return COLUMNS[this.width];
  }

  private style({ bold = false, align = "left", size = "normal" }: Style) {
    this.bytes.push(ESC, 0x61, align === "center" ? 1 : align === "right" ? 2 : 0);
    this.bytes.push(ESC, 0x45, bold ? 1 : 0);
    this.bytes.push(GS, 0x21, size === "double" ? 0x11 : 0x00);
  }

  /** Uma ou mais linhas, quebradas na largura (pela metade quando o texto é dobrado). */
  text(content: string, style: Style = {}) {
    this.style(style);
    const width = style.size === "double" ? Math.floor(this.columns / 2) : this.columns;
    for (const line of wrap(content, width)) this.bytes.push(...encodeText(line, this.encoding), 0x0a);
    this.style({});
    return this;
  }

  /** Linha com o valor alinhado à direita. */
  row(left: string, right: string, style: Style = {}) {
    this.style(style);
    for (const line of twoColumns(left, right, this.columns)) this.bytes.push(...encodeText(line, this.encoding), 0x0a);
    this.style({});
    return this;
  }

  separator(char = "-") {
    this.bytes.push(...encodeText(char.repeat(this.columns), this.encoding), 0x0a);
    return this;
  }

  feed(lines = 1) {
    this.bytes.push(ESC, 0x64, lines);
    return this;
  }

  /** Avança o papel e corta (as que não têm guilhotina ignoram o corte). */
  cut() {
    this.feed(4);
    this.bytes.push(GS, 0x56, 0x42, 0x00);
    return this;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
