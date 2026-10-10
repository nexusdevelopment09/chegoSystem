// O contrato que todo gateway de pagamento implementa. O resto do sistema só
// conversa com esta interface, então trocar o gateway só mexe em lib/payments.

export type PaymentMethod = "pix" | "card";

export type CardData = { number: string; holder: string; expiry: string; cvv: string };

export type CreatePaymentInput = {
  /** O nosso id do pagamento, enviado ao gateway como referência externa. */
  reference: string;
  amountCents: number;
  method: PaymentMethod;
  description: string;
  expiresAt: Date;
  /** Como o gateway divide o dinheiro. Ausente nas faturas de mensalidade. */
  split?: { storeRecipientId: string | null; storeAmountCents: number; platformAmountCents: number };
  card?: CardData;
};

export type CreatedPayment = {
  providerPaymentId: string;
  pixCopyPaste: string | null;
  raw: unknown;
};

export type WebhookEvent = {
  /** Único por evento no gateway: é o que torna inofensiva uma entrega repetida. */
  eventId: string;
  providerPaymentId: string;
  type: "payment.approved" | "payment.declined" | "payment.expired";
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  refund(input: { providerPaymentId: string; amountCents: number; reason: string }): Promise<{ providerRefundId: string }>;
  /** Confere a assinatura e lê o evento. Devolve null quando a assinatura está errada. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent | null;
}
