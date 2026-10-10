"use client";

import { useSyncExternalStore } from "react";
import type { Pick as OptionPick } from "@/lib/catalog/selection";

// A sacola guardada no aparelho. Os preços aqui são só para mostrar: o servidor
// recalcula tudo a partir do banco no checkout.

export type CartItem = {
  /** Único por linha, então o mesmo produto com outras opções é outra linha. */
  key: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  notes: string;
  picks: OptionPick[];
  /** "1/2 Calabresa", "Borda: Catupiry"... */
  lines: string[];
};

export type Cart = {
  storeId: string;
  storeSlug: string;
  storeName: string;
  notes: string;
  items: CartItem[];
};

export type CartStore = Pick<Cart, "storeId" | "storeSlug" | "storeName">;

const KEY = "chego_cart";
const EVENT = "chego-cart-change";

let cachedRaw: string | null | undefined;
let cachedCart: Cart | null = null;

export function readCart(): Cart | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedCart = raw ? (JSON.parse(raw) as Cart) : null;
    } catch {
      cachedCart = null;
    }
  }
  return cachedCart;
}

export function writeCart(cart: Cart | null) {
  try {
    if (cart && cart.items.length > 0) window.localStorage.setItem(KEY, JSON.stringify(cart));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Armazenamento cheio ou bloqueado: a sacola só não sobrevive a um recarregamento.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** A sacola é de uma loja por vez. Devolve o nome da outra loja quando há conflito. */
export function cartConflict(store: CartStore): string | null {
  const cart = readCart();
  return cart && cart.items.length > 0 && cart.storeId !== store.storeId ? cart.storeName : null;
}

/** Adiciona um item. Com `replace` a sacola de outra loja é esvaziada antes. */
export function addToCart(store: CartStore, item: Omit<CartItem, "key">, replace = false) {
  const current = readCart();
  const base: Cart =
    current && current.storeId === store.storeId && !replace
      ? current
      : { ...store, notes: "", items: [] };

  const key = `${item.productId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  writeCart({ ...base, items: [...base.items, { ...item, key }] });
}

export function updateCartItem(key: string, changes: Partial<Pick<CartItem, "quantity" | "notes">>) {
  const cart = readCart();
  if (!cart) return;
  const items = cart.items
    .map((item) => (item.key === key ? { ...item, ...changes } : item))
    .filter((item) => item.quantity > 0);
  writeCart({ ...cart, items });
}

export function setCartNotes(notes: string) {
  const cart = readCart();
  if (cart) writeCart({ ...cart, notes });
}

export const clearCart = () => writeCart(null);

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** A sacola, redesenhando a cada mudança (também vinda de outras abas). Null no servidor. */
export function useCart(): Cart | null {
  return useSyncExternalStore(subscribe, readCart, () => null);
}

export const cartCount = (cart: Cart | null) =>
  cart ? cart.items.reduce((total, item) => total + item.quantity, 0) : 0;

export const cartSubtotalCents = (cart: Cart | null) =>
  cart ? cart.items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0) : 0;

// -------------------------------------------------------------------- cupom

const COUPON_KEY = "chego_coupon";

function readCoupon(): string {
  try {
    return window.localStorage.getItem(COUPON_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeCoupon(code: string) {
  try {
    if (code) window.localStorage.setItem(COUPON_KEY, code);
    else window.localStorage.removeItem(COUPON_KEY);
  } catch {
    // O cupom só precisa ser digitado de novo.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** O código do cupom que o cliente digitou, guardado no aparelho. Vazio no servidor. */
export function useCoupon(): string {
  return useSyncExternalStore(subscribe, readCoupon, () => "");
}
