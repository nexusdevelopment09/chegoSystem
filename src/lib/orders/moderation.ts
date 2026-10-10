// Moderação das mensagens entre cliente e loja. A ideia é que ninguém
// leve a venda para fora do app: nada de telefone, e-mail, link, @ nem
// "me chama no zap". Funções puras.

export type ModerationResult = { allowed: true } | { allowed: false; rule: string };

export const BLOCKED_MESSAGE = "Por segurança, não é permitido trocar contatos por aqui.";

const NUMBER_WORDS =
  "zero|um|uma|dois|duas|tres|quatro|cinco|seis|meia|sete|oito|nove";

/** Em minúsculas, sem acentos e desfazendo os truques comuns de trocar letra por número. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Maior sequência de dígitos, aceitando os separadores que as pessoas usam para
 * disfarçar um telefone: espaços, pontos, traços, parênteses, barras.
 * "R$ 25,90" tem vírgula, que quebra a sequência, então preços não são pegos.
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

  // 8 dígitos ou mais seguidos é um telefone (preços, horários, códigos de pedido
  // e números de casa são mais curtos).
  if (longestDigitRun(text) >= 8) return block("phone");

  // Um telefone escrito por extenso: "oito dois nove nove nove..."
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

/** As mensagens ficam abertas do pagamento até 2 horas depois de o pedido ser concluído. */
export function chatOpen(order: { paidAt: Date | null; completedAt: Date | null; status: string }, now: Date): boolean {
  if (!order.paidAt) return false;
  if (["rejected", "cancelled", "expired", "refunded"].includes(order.status)) return false;
  if (!order.completedAt) return true;
  return now.getTime() <= order.completedAt.getTime() + 2 * 60 * 60 * 1000;
}
