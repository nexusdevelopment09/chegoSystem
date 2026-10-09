const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Money is stored as integer cents everywhere. 123456 -> "R$ 1.234,56". */
export function formatCents(cents: number): string {
  // Intl uses a non-breaking space after "R$"; keep a regular one for copy/paste.
  return brl.format(cents / 100).replace(/ /g, " ");
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
