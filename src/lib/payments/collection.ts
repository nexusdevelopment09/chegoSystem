// Quem recebe o dinheiro do cliente.
//
// "store" (padrão): o cliente paga direto à loja, por Pix da loja, dinheiro ou cartão
// na entrega. O pedido vai para a loja na hora, sem passar pelo app, e o Chegô cobra
// da loja uma taxa por pedido concluído (src/lib/fees/).
//
// "app": o cliente paga pelo app (gateway, com a divisão automática entre loja e
// plataforma). É o caminho preparado para quando houver um gateway de verdade.
import { isLocalEnv } from "@/lib/env";

export type PaymentCollection = "app" | "store";

/** Lido a cada chamada, para os testes poderem trocar o modo. */
export function paymentCollection(): PaymentCollection {
  return collectionFor({ collection: process.env.PAYMENT_COLLECTION, provider: process.env.PAYMENT_PROVIDER, local: isLocalEnv });
}

/**
 * Pagamento pelo app só com gateway de verdade. O gateway de mentira (cartão final 0000
 * aprova, o cliente "confirma" o Pix) só vale no ambiente de testes: fora dele, mesmo com
 * PAYMENT_COLLECTION=app, o cliente paga direto à loja.
 */
export function collectionFor(env: { collection?: string; provider?: string; local: boolean }): PaymentCollection {
  if (env.collection !== "app") return "store";
  const mock = (env.provider ?? "mock") === "mock";
  return mock && !env.local ? "store" : "app";
}

/** Como o cliente paga direto à loja, por extenso. */
export const STORE_PAYMENT_LABELS = {
  pix: "Pix para a loja",
  card: "Cartão na entrega (maquininha da loja)",
  cash: "Dinheiro na entrega",
} as const;
