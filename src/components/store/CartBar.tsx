"use client";

import Link from "next/link";
import { cartCount, cartSubtotalCents, useCart } from "@/lib/cart/local";
import { formatCents } from "@/lib/format";

/** Bar fixed at the bottom while there is something in the cart. */
export function CartBar() {
  const cart = useCart();
  const count = cartCount(cart);
  if (!cart || count === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 border-t border-peach bg-cream px-4 py-3">
      <Link
        href="/carrinho"
        data-testid="cart-bar"
        className="mx-auto flex min-h-12 w-full max-w-2xl items-center justify-between rounded-full bg-brand-dark px-6 font-bold text-white hover:bg-brand-darker"
      >
        <span>Ver carrinho · {count} {count === 1 ? "item" : "itens"}</span>
        <span>{formatCents(cartSubtotalCents(cart))}</span>
      </Link>
    </div>
  );
}
