"use client";

import { useEffect, useRef, useState } from "react";
import { readCart, useCart, writeCart, type Cart } from "@/lib/cart/local";
import { toCartPayload } from "@/lib/cart/payload";

/**
 * Keeps the cart on the device and on the server in step for signed-in
 * customers: an empty device picks up the saved cart, and every change is
 * saved a moment later. Renders nothing.
 */
const loadSaved = (): Promise<Cart | null> =>
  fetch("/api/carrinho").then((response) => response.json()).then((data: { cart: Cart | null }) => data.cart);

const save = (payload: unknown) =>
  fetch("/api/carrinho", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

export function CartSync() {
  const cart = useCart();
  const [ready, setReady] = useState(false);
  const lastSaved = useRef<string | null>(null);

  // First, bring back the saved cart if this device has none.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = readCart() ? null : await loadSaved().catch(() => null);
      if (cancelled) return;
      if (saved && !readCart()) {
        lastSaved.current = JSON.stringify(toCartPayload(saved));
        writeCart(saved);
      } else if (!readCart()) {
        lastSaved.current = "null";
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Then save every change, a moment after the customer stops editing.
  useEffect(() => {
    if (!ready) return;
    const payload = cart ? toCartPayload(cart) : null;
    const serialized = JSON.stringify(payload);
    if (serialized === lastSaved.current) return;
    const timer = setTimeout(() => {
      lastSaved.current = serialized;
      save(payload).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [cart, ready]);

  return null;
}
