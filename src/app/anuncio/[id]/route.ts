import { NextResponse, type NextRequest } from "next/server";
import { AD_ATTRIBUTION_MS, AD_COOKIE, campaignTarget, recordClick } from "@/lib/ads/campaigns";
import { now } from "@/lib/clock";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Clique num anúncio: conta o clique, guarda a campanha por 24 h (para atribuir o pedido) e leva
// para a loja. Cliques repetidos do mesmo endereço não contam de novo, mas a pessoa chega na loja.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = /^[0-9a-f-]{36}$/i.test(id) ? await campaignTarget(id) : null;
  if (!target) return NextResponse.redirect(new URL("/", request.url));

  const at = await now();
  if (await rateLimit(`ad-click:${id}:${await clientIp()}`, 3, 3600)) await recordClick(id, at);
  const response = NextResponse.redirect(new URL(target, request.url));
  response.cookies.set(AD_COOKIE, `${id}.${at.getTime()}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: AD_ATTRIBUTION_MS / 1000 });
  return response;
}
