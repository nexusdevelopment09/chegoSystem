import "server-only";
import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./types";

let provider: PaymentProvider | null = null;

/** The gateway chosen by PAYMENT_PROVIDER. Only "mock" exists for now. */
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const name = process.env.PAYMENT_PROVIDER ?? "mock";
  if (name !== "mock") {
    throw new Error(`Payment provider "${name}" is not implemented. Use PAYMENT_PROVIDER=mock.`);
  }
  provider = new MockPaymentProvider();
  return provider;
}
