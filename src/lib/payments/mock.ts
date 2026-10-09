import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CreatedPayment, CreatePaymentInput, PaymentProvider, WebhookEvent } from "./types";

// A pretend gateway for the test environment. No real money, no network.
// It signs its webhooks exactly like a real gateway would, so the webhook
// code (signature check, idempotency) is the same that will run in production.

const secret = () => process.env.PAYMENT_WEBHOOK_SECRET ?? "segredo-local-de-teste";

export const signMockBody = (rawBody: string) => createHmac("sha256", secret()).update(rawBody).digest("hex");

/** Test cards: final 0000 approves, final 1111 declines. */
export function mockCardOutcome(cardNumber: string): "approved" | "declined" {
  return cardNumber.replace(/\D/g, "").endsWith("1111") ? "declined" : "approved";
}

/** The body and signature the pretend gateway would POST to our webhook. */
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
      // Looks like a Pix "copia e cola" code, but it is not a valid one.
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
