// CPF e CNPJ: limpeza, conferência dos dígitos verificadores e formatação. Funções puras.

export type DocumentType = "cpf" | "cnpj";

export const DOCUMENT_LABELS: Record<DocumentType, string> = { cpf: "CPF", cnpj: "CNPJ" };

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** Dígito verificador pelo módulo 11, com os pesos informados. */
function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(text: string): boolean {
  const cpf = digitsOf(text);
  // Sequências como 111.111.111-11 passam na conta, mas não existem.
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const first = checkDigit(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cpf[9]) && second === Number(cpf[10]);
}

export function isValidCnpj(text: string): boolean {
  const cnpj = digitsOf(text);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const first = checkDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

/** Completa os 9 primeiros números de um CPF com os dois dígitos verificadores. Usado para gerar dados de teste. */
export function completeCpf(base: string): string {
  const nine = digitsOf(base).padStart(9, "0").slice(0, 9);
  const first = checkDigit(nine, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${nine}${first}${checkDigit(`${nine}${first}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

/** Completa os 12 primeiros números de um CNPJ com os dois dígitos verificadores. Usado para gerar dados de teste. */
export function completeCnpj(base: string): string {
  const twelve = digitsOf(base).padStart(12, "0").slice(0, 12);
  const first = checkDigit(twelve, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${twelve}${first}${checkDigit(`${twelve}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

/** "12345678909" -> "123.456.789-09"; "11222333000181" -> "11.222.333/0001-81". Aceita número incompleto (máscara ao digitar). */
export function formatDocument(type: DocumentType, text: string): string {
  const digits = digitsOf(text).slice(0, type === "cpf" ? 11 : 14);
  const cuts = type === "cpf" ? [[3, "."], [6, "."], [9, "-"]] as const : [[2, "."], [5, "."], [8, "/"], [12, "-"]] as const;
  let result = "";
  for (let index = 0; index < digits.length; index += 1) {
    const cut = cuts.find(([position]) => position === index);
    if (cut) result += cut[1];
    result += digits[index];
  }
  return result;
}

/** Confere o documento digitado. Devolve só os números, ou a mensagem de erro para mostrar. */
export function parseDocument(type: unknown, text: unknown): { ok: true; type: DocumentType; digits: string } | { ok: false; error: string } {
  if (type !== "cpf" && type !== "cnpj") return { ok: false, error: "Escolha CPF ou CNPJ." };
  const digits = digitsOf(String(text ?? ""));
  if (type === "cpf") {
    if (digits.length !== 11) return { ok: false, error: "O CPF tem 11 números." };
    if (!isValidCpf(digits)) return { ok: false, error: "Esse CPF não existe. Confira os números." };
  } else {
    if (digits.length !== 14) return { ok: false, error: "O CNPJ tem 14 números." };
    if (!isValidCnpj(digits)) return { ok: false, error: "Esse CNPJ não existe. Confira os números." };
  }
  return { ok: true, type, digits };
}
