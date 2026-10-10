"use client";

import { useEffect, useRef, useState } from "react";
import { readCart, useCart, writeCart, type Cart } from "@/lib/cart/local";
import { toCartPayload } from "@/lib/cart/payload";

/**
 * Mantém a sacola do aparelho e a do servidor em sincronia para clientes que
 * entraram: um aparelho vazio recupera a sacola salva, e toda mudança é
 * salva um instante depois. Não desenha nada.
 */
const loadSaved = (): Promise<Cart | null> =>
  fetch("/api/carrinho").then((response) => response.json()).then((data: { cart: Cart | null }) => data.cart);

const save = (payload: unknown) =>
  fetch("/api/carrinho", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

export function CartSync() {
  const cart = useCart();
  const [ready, setReady] = useState(false);
  const lastSaved = useRef<string | null>(null);

  // Primeiro, traz de volta a sacola salva se este aparelho não tiver nenhuma.
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

  // Depois salva cada mudança, um instante depois que o cliente para de editar.
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
