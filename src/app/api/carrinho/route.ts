import { loadCartFromServer, saveCartOnServer } from "@/lib/cart/server";

// A sacola do cliente que entrou, salva no servidor, para acompanhá-lo em
// outro aparelho. Rotas comuns (não Server Actions) porque são chamadas
// em segundo plano e não podem redesenhar a página.

export async function GET() {
  return Response.json({ cart: await loadCartFromServer() });
}

export async function PUT(request: Request) {
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return new Response("Bad request", { status: 400 });
  await saveCartOnServer(body);
  return Response.json({ saved: true });
}
