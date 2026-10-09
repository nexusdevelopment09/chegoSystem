import { getCurrentProfile } from "@/lib/auth/session";
import { buildQuote, cartInputSchema } from "@/lib/checkout/quote";
import { now } from "@/lib/clock";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { getShoppingContext } from "@/lib/shopping-context";

// Server-side recalculation of a cart: every price, fee and total comes from
// the database. Called by the cart and checkout pages on every change.
export async function POST(request: Request) {
  const parsed = cartInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ fatal: "Seu carrinho está com um problema. Esvazie e monte de novo." });
  }

  const [profile, context, at] = await Promise.all([getCurrentProfile(), getShoppingContext(), now()]);
  if (parsed.data.couponCode && !(await rateLimit(`coupon:${profile?.id ?? (await clientIp())}`, 40, 600))) {
    return Response.json({ fatal: TOO_MANY_ATTEMPTS });
  }

  const built = await buildQuote(parsed.data, profile, at, {
    mode: "preview",
    fallbackNeighborhoodId: context.neighborhood?.id,
  });
  return Response.json("fatal" in built ? built : { quote: built.quote });
}
