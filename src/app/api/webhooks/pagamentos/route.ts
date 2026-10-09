import { handlePaymentWebhook } from "@/lib/payments/webhook";

// Where the payment gateway tells us a payment was approved, declined or
// expired. Public by nature, so it trusts nothing but the signature.
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return new Response("Payload too large", { status: 413 });

  let outcome;
  try {
    outcome = await handlePaymentWebhook(rawBody, request.headers.get("x-signature"));
  } catch (error) {
    console.error("[webhook] failed to process payment event", error);
    // A 500 makes the gateway try again later; the event was not recorded.
    return new Response("Error", { status: 500 });
  }

  if (outcome === "invalid_signature") return new Response("Invalid signature", { status: 401 });
  // Duplicates and unknown payments still answer 200, so the gateway stops retrying.
  return Response.json({ received: true, outcome });
}
