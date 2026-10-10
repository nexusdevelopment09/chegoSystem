import { handlePaymentWebhook } from "@/lib/payments/webhook";

// Onde o gateway de pagamento avisa que um pagamento foi aprovado, recusado ou
// expirou. É público por natureza, então só confia na assinatura.
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return new Response("Payload too large", { status: 413 });

  let outcome;
  try {
    outcome = await handlePaymentWebhook(rawBody, request.headers.get("x-signature"));
  } catch (error) {
    console.error("[webhook] failed to process payment event", error);
    // Um 500 faz o gateway tentar de novo mais tarde; o evento não foi gravado.
    return new Response("Error", { status: 500 });
  }

  if (outcome === "invalid_signature") return new Response("Invalid signature", { status: 401 });
  // Duplicados e pagamentos desconhecidos ainda respondem 200, para o gateway parar de tentar.
  return Response.json({ received: true, outcome });
}
