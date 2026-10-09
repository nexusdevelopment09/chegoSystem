// The contract every payment gateway implements. The rest of the system only
// talks to this interface, so swapping the gateway touches lib/payments only.

export type PaymentMethod = "pix" | "card";

export type CardData = { number: string; holder: string; expiry: string; cvv: string };

export type CreatePaymentInput = {
  /** Our own payment id, sent to the gateway as the external reference. */
  reference: string;
  amountCents: number;
  method: PaymentMethod;
  description: string;
  expiresAt: Date;
  /** How the gateway splits the money. Absent for subscription invoices. */
  split?: { storeRecipientId: string | null; storeAmountCents: number; platformAmountCents: number };
  card?: CardData;
};

export type CreatedPayment = {
  providerPaymentId: string;
  pixCopyPaste: string | null;
  raw: unknown;
};

export type WebhookEvent = {
  /** Unique per event at the gateway: what makes a repeated delivery harmless. */
  eventId: string;
  providerPaymentId: string;
  type: "payment.approved" | "payment.declined" | "payment.expired";
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  refund(input: { providerPaymentId: string; amountCents: number; reason: string }): Promise<{ providerRefundId: string }>;
  /** Checks the signature and reads the event. Returns null when the signature is wrong. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent | null;
}
