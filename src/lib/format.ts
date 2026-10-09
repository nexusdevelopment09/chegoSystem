const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Money is stored as integer cents everywhere. 123456 -> "R$ 1.234,56". */
export function formatCents(cents: number): string {
  // Intl uses a non-breaking space after "R$"; keep a regular one for copy/paste.
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

/** Date and time in Maceió: "09/10/2026, 14:30". */
export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}

/** Value for an <input type="datetime-local">, in Maceió time (UTC-3 all year). */
export function toDateTimeLocal(date: Date): string {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** "+5582900000001" or "82900000001" -> "(82) 90000-0001". */
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

/** Brazilian phone in any common format -> E.164 ("+5582900000001"), or null. */
export function toE164(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;
  return `+55${digits}`;
}
