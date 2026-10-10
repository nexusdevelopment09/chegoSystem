const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Dinheiro é guardado em centavos inteiros em todo lugar. 123456 -> "R$ 1.234,56". */
export function formatCents(cents: number): string {
  // O Intl usa um espaço que não quebra linha depois de "R$"; aqui fica um espaço comum, para copiar e colar.
  return brl.format(cents / 100).replace(/ /g, " ");
}

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Maceio",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Data e hora em Maceió: "09/10/2026, 14:30". */
export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}

/** Valor para um <input type="datetime-local">, no horário de Maceió (UTC-3 o ano todo). */
export function toDateTimeLocal(date: Date): string {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** "+5582900000001" ou "82900000001" -> "(82) 90000-0001". */
export function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/** Telefone brasileiro em qualquer formato comum -> E.164 ("+5582900000001"), ou null. */
export function toE164(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  return `+55${digits}`;
}

/** "12,50", "R$ 1.234,56" ou "12.5" -> centavos. Null quando não é um valor válido. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[R$\s]/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(clean)) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  return Math.round(Number(normalized) * 100);
}
