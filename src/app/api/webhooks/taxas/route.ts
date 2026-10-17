import { now } from "@/lib/clock";
import { handleFeeWebhook } from "@/lib/fees/charges";

// Onde o provedor Pix avisa que a cobrança das taxas de uma loja foi paga ou expirou.
// É público por natureza (o Caddy deixa /api/webhooks/* passar), então só confia na assinatura.
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return new Response("Payload too large", { status: 413 });

  let outcome;
  try {
    outcome = await handleFeeWebhook(rawBody, request.headers.get("x-signature"), await now());
  } catch (error) {
    console.error("[webhook] failed to process fee charge event", error);
    // Um 500 faz o provedor tentar de novo mais tarde; o evento não foi gravado.
    return new Response("Error", { status: 500 });
  }

  if (outcome === "invalid_signature") return new Response("Invalid signature", { status: 401 });
  if (outcome === "unavailable") return new Response("Not configured", { status: 503 });
  // Duplicados, desconhecidos e divergentes respondem 200, para o provedor parar de tentar.
  return Response.json({ received: true, outcome });
}
