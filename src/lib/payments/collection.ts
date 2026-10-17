// Quem recebe o dinheiro do cliente.
//
// "store" (padrão): o cliente paga direto à loja, por Pix da loja, dinheiro ou cartão
// na entrega. O pedido vai para a loja na hora, sem passar pelo app, e o Chegô cobra
// da loja uma taxa por pedido concluído (src/lib/fees/).
//
// "app": o cliente paga pelo app (gateway, com a divisão automática entre loja e
// plataforma). É o caminho preparado para quando houver um gateway de verdade.
export type PaymentCollection = "app" | "store";

/** Lido a cada chamada, para os testes poderem trocar o modo. */
export function paymentCollection(): PaymentCollection {
  return process.env.PAYMENT_COLLECTION === "app" ? "app" : "store";
}

/** Como o cliente paga direto à loja, por extenso. */
export const STORE_PAYMENT_LABELS = {
  pix: "Pix para a loja",
  card: "Cartão na entrega (maquininha da loja)",
  cash: "Dinheiro na entrega",
} as const;
