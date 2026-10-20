import "server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isLocalEnv } from "@/lib/env";
import type { CreatedPayment, CreatePaymentInput, PaymentProvider, WebhookEvent } from "./types";

// Um gateway de mentira para o ambiente de testes. Sem dinheiro de verdade, sem rede.
// Ele assina os webhooks exatamente como um gateway de verdade, então o código
// do webhook (checagem da assinatura, idempotência) é o mesmo que vai rodar em produção.

// Sem PAYMENT_WEBHOOK_SECRET fora do ambiente de testes, um segredo aleatório por processo:
// nenhum webhook passa (falha fechada), em vez de aceitar um segredo conhecido.
const UNGUESSABLE = randomBytes(32).toString("hex");
const secret = () => process.env.PAYMENT_WEBHOOK_SECRET || (isLocalEnv ? "segredo-local-de-teste" : UNGUESSABLE);

export const signMockBody = (rawBody: string) => createHmac("sha256", secret()).update(rawBody).digest("hex");

/** Cartões de teste: final 0000 aprova, final 1111 recusa. */
export function mockCardOutcome(cardNumber: string): "approved" | "declined" {
  return cardNumber.replace(/\D/g, "").endsWith("1111") ? "declined" : "approved";
}

/** O corpo e a assinatura que o gateway de mentira enviaria por POST ao nosso webhook. */
export function buildMockWebhook(providerPaymentId: string, type: WebhookEvent["type"], eventId: string = randomUUID()) {
  const rawBody = JSON.stringify({ id: eventId, type, data: { payment_id: providerPaymentId } });
  return { rawBody, signature: signMockBody(rawBody) };
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const providerPaymentId = `mock_${randomUUID()}`;
    return {
      providerPaymentId,
      // Parece um código "copia e cola" do Pix, mas não é um código válido.
      pixCopyPaste:
        input.method === "pix"
          ? `00020126580014BR.GOV.BCB.PIX0136chego-teste-${providerPaymentId.slice(5, 17)}5204000053039865802BR5905CHEGO6013JOAQUIM GOMES6304TEST`
          : null,
      raw: { mock: true, amount: input.amountCents, split: input.split ?? null, reference: input.reference },
    };
  }

  async refund(): Promise<{ providerRefundId: string }> {
    return { providerRefundId: `mock_refund_${randomUUID()}` };
  }

  parseWebhook(rawBody: string, signature: string | null): WebhookEvent | null {
    if (!signature) return null;
    const expected = Buffer.from(signMockBody(rawBody), "hex");
    const received = Buffer.from(signature, "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    try {
      const body = JSON.parse(rawBody) as { id?: unknown; type?: unknown; data?: { payment_id?: unknown } };
      const types = ["payment.approved", "payment.declined", "payment.expired"];
      if (typeof body.id !== "string" || typeof body.data?.payment_id !== "string" || !types.includes(body.type as string)) {
        return null;
      }
      return { eventId: body.id, providerPaymentId: body.data.payment_id, type: body.type as WebhookEvent["type"], raw: body };
    } catch {
      return null;
    }
  }
}
