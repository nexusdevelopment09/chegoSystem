"use client";

import { useSyncExternalStore } from "react";
import type { Pick as OptionPick } from "@/lib/catalog/selection";

// The cart kept on the device. Prices here are only for display: the server
// recalculates everything from the database at checkout.

export type CartItem = {
  /** Unique per line, so the same product with other options is another line. */
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
    // Storage full or blocked: the cart just does not survive a reload.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The cart belongs to one store at a time. Returns the other store's name on conflict. */
export function cartConflict(store: CartStore): string | null {
  const cart = readCart();
  return cart && cart.items.length > 0 && cart.storeId !== store.storeId ? cart.storeName : null;
}

/** Adds an item. With `replace` the cart of another store is emptied first. */
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

/** The cart, re-rendering on every change (also from other tabs). Null on the server. */
export function useCart(): Cart | null {
  return useSyncExternalStore(subscribe, readCart, () => null);
}

export const cartCount = (cart: Cart | null) =>
  cart ? cart.items.reduce((total, item) => total + item.quantity, 0) : 0;

export const cartSubtotalCents = (cart: Cart | null) =>
  cart ? cart.items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0) : 0;

// ------------------------------------------------------------------ coupon

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
    // The coupon just has to be typed again.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The coupon code the customer typed, kept on the device. Empty on the server. */
export function useCoupon(): string {
  return useSyncExternalStore(subscribe, readCoupon, () => "");
}
