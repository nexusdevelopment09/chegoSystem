import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isLocalEnv } from "@/lib/env";

// Quem gera o Pix que a loja paga ao Chegô pelas taxas. O resto do sistema só conhece
// esta interface; um provedor de verdade (Asaas, Mercado Pago, Efí...) entra aqui,
// seguindo a documentação oficial dele, sem mudar o fechamento nem as telas.

export type FeeChargeInput = {
  /** Identificador único da cobrança no Chegô (vai como referência/idempotência). */
  reference: string;
  amountCents: number;
  description: string;
  expiresAt: Date;
};

export type CreatedFeeCharge = { providerChargeId: string; pixCopyPaste: string; receiverName: string };

export type FeeWebhookEvent = {
  eventId: string;
  type: "charge.paid" | "charge.expired";
  providerChargeId: string;
  /** Só nos pagamentos. */
  transactionId: string | null;
  amountCents: number | null;
  raw: unknown;
};

export interface FeePixProvider {
  readonly name: string;
  /** Verdadeiro quando o código Pix gerado é de mentira (só no ambiente local). */
  readonly simulated: boolean;
  createCharge(input: FeeChargeInput): Promise<CreatedFeeCharge>;
  /** Confere a assinatura e lê o aviso. Assinatura errada: null. */
  parseWebhook(rawBody: string, signature: string | null): FeeWebhookEvent | null;
}

// ------------------------------------------------- provedor simulado (local)

const secret = () => process.env.FEE_PIX_WEBHOOK_SECRET ?? process.env.PAYMENT_WEBHOOK_SECRET ?? "segredo-local-de-teste";
const sign = (rawBody: string) => createHmac("sha256", secret()).update(rawBody).digest("hex");

/** O aviso que o provedor simulado mandaria ao nosso webhook (só para testes e para a tela local). */
export function buildMockFeeWebhook(event: { type: FeeWebhookEvent["type"]; providerChargeId: string; amountCents?: number; transactionId?: string; eventId?: string }) {
  const rawBody = JSON.stringify({
    id: event.eventId ?? randomUUID(),
    type: event.type,
    data: { charge_id: event.providerChargeId, transaction_id: event.transactionId ?? (event.type === "charge.paid" ? `mocktx_${randomUUID()}` : null), amount_cents: event.amountCents ?? null },
  });
  return { rawBody, signature: sign(rawBody) };
}

class MockFeePixProvider implements FeePixProvider {
  readonly name = "mock";
  readonly simulated = true;

  async createCharge(input: FeeChargeInput): Promise<CreatedFeeCharge> {
    const providerChargeId = `mockfee_${randomUUID()}`;
    return {
      providerChargeId,
      // Parece um "copia e cola", mas não é um Pix válido: só existe no ambiente local.
      pixCopyPaste: `TESTE-SEM-VALOR-${input.reference.slice(0, 8)}-${input.amountCents}`,
      receiverName: "Chegô (teste)",
    };
  }

  parseWebhook(rawBody: string, signature: string | null): FeeWebhookEvent | null {
    if (!signature) return null;
    const expected = Buffer.from(sign(rawBody), "hex");
    const received = Buffer.from(signature, "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    try {
      const body = JSON.parse(rawBody) as { id?: unknown; type?: unknown; data?: { charge_id?: unknown; transaction_id?: unknown; amount_cents?: unknown } };
      if (typeof body.id !== "string" || typeof body.data?.charge_id !== "string") return null;
      if (body.type !== "charge.paid" && body.type !== "charge.expired") return null;
      return {
        eventId: body.id, type: body.type, providerChargeId: body.data.charge_id,
        transactionId: typeof body.data.transaction_id === "string" ? body.data.transaction_id : null,
        amountCents: typeof body.data.amount_cents === "number" ? body.data.amount_cents : null,
        raw: body,
      };
    } catch {
      return null;
    }
  }
}

/**
 * O provedor configurado, ou null quando a cobrança Pix ainda não está disponível.
 * O simulado só vale no ambiente local: em qualquer outro lugar, sem um provedor de
 * verdade configurado, a tela avisa que a cobrança está indisponível.
 */
export function getFeePixProvider(): FeePixProvider | null {
  const name = process.env.FEE_PIX_PROVIDER ?? (isLocalEnv ? "mock" : "");
  if (name === "mock" && isLocalEnv) return new MockFeePixProvider();
  return null;
}
