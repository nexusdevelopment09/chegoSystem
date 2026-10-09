import { loadCartFromServer, saveCartOnServer } from "@/lib/cart/server";

// The signed-in customer's cart saved on the server, so it follows them to
// another device. Plain routes (not Server Actions) because they are called
// in the background and must not re-render the page.

export async function GET() {
  return Response.json({ cart: await loadCartFromServer() });
}

export async function PUT(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return new Response("Bad request", { status: 400 });
  await saveCartOnServer(body);
  return Response.json({ saved: true });
}
