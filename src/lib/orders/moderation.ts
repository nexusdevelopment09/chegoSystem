// Moderation of the messages between customer and store. The point is that
// nobody takes the sale outside the app: no phones, e-mails, links, handles
// or "call me on zap". Pure functions.

export type ModerationResult = { allowed: true } | { allowed: false; rule: string };

export const BLOCKED_MESSAGE = "Por segurança, não é permitido trocar contatos por aqui.";

const NUMBER_WORDS =
  "zero|um|uma|dois|duas|tres|quatro|cinco|seis|meia|sete|oito|nove";

/** Lowercase, without accents, and with common letter-for-digit tricks undone. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Longest run of digits allowing the separators people use to disguise a
 * phone number: spaces, dots, dashes, parentheses, slashes.
 * "R$ 25,90" has a comma, which breaks the run, so prices are not caught.
 */
function longestDigitRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/\d(?:[\s.\-()/+]*\d)*/g) ?? []) {
    longest = Math.max(longest, run.replace(/\D/g, "").length);
  }
  return longest;
}

export function moderateMessage(raw: string): ModerationResult {
  const text = normalize(raw);
  const block = (rule: string): ModerationResult => ({ allowed: false, rule });

  // 8 digits or more in a row is a phone number (prices, times, order codes
  // and house numbers are shorter).
  if (longestDigitRun(text) >= 8) return block("phone");

  // A phone number spelled out: "oito dois nove nove nove..."
  if (new RegExp(`(?:\\b(?:${NUMBER_WORDS})\\b[\\s,.-]*){6,}`).test(text)) return block("phone_spelled");

  if (/[\w.+-]+\s*(?:@|\barroba\b)\s*[\w-]+\s*(?:\.|\bponto\b)\s*[a-z]{2,}/.test(text)) return block("email");
  if (/(?:https?:\/\/|www\.)\S+/.test(text)) return block("link");
  if (/\b[\w-]+\.(?:com|net|org|app|me|link|ly|io)(?:\.br)?\b/.test(text) || /\b[\w-]+\.br\b/.test(text)) return block("link");
  if (/(?:^|\s)@\w{2,}/.test(text) || /\barroba\b/.test(text)) return block("handle");

  const words: [RegExp, string][] = [
    [/\bzap\w*/, "zap"],
    [/\bwhats\w*|\bwats\w*|\buats\w*/, "whats"],
    [/\bwpp\b|\bwp\b|\bzp\b/, "wpp"],
    [/\btelegram\b|\binsta(?:gram)?\b|\bfacebook\b|\bmessenger\b|\bdirect\b/, "social"],
    [/\bpix\s+direto\b|\bpix\s+por\s+fora\b|\bpor\s+fora\b|\bfora\s+do\s+app\b/, "pix_direto"],
    [/\bme\s+chama\b|\bme\s+liga\b|\bme\s+add?\b|\bmeu\s+numero\b|\bmeu\s+contato\b|\bseu\s+numero\b|\bpassa\s+(?:o\s+)?(?:seu\s+)?(?:numero|contato)\b/, "me_chama"],
  ];
  for (const [pattern, rule] of words) {
    if (pattern.test(text)) return block(rule);
  }

  return { allowed: true };
}

/** Messages are open from the payment until 2 hours after the order is finished. */
export function chatOpen(order: { paidAt: Date | null; completedAt: Date | null; status: string }, now: Date): boolean {
  if (!order.paidAt) return false;
  if (["rejected", "cancelled", "expired", "refunded"].includes(order.status)) return false;
  if (!order.completedAt) return true;
  return now.getTime() <= order.completedAt.getTime() + 2 * 60 * 60 * 1000;
}
