"use client";

import { useEffect, useState } from "react";
import type { Cart } from "@/lib/cart/local";
import { toCartPayload, type CheckoutChoices } from "@/lib/cart/payload";
import type { Quote } from "@/lib/checkout/quote";

export type QuoteState =
  | { status: "loading"; quote: Quote | null }
  | { status: "ready"; quote: Quote }
  | { status: "error"; quote: null; message: string };

type Answer = { signature: string; quote: Quote | null; error: string | null };

/** Pede ao servidor para recalcular a sacola sempre que a sacola ou as escolhas mudam. */
export function useQuote(cart: Cart | null, choices: CheckoutChoices): QuoteState {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const signature = cart ? JSON.stringify(toCartPayload(cart, choices)) : null;

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      fetch("/api/carrinho/cotacao", { method: "POST", headers: { "content-type": "application/json" }, body: signature })
        .then((result) => result.json() as Promise<{ quote: Quote } | { fatal: string }>)
        .then((response) => {
          if (cancelled) return;
          setAnswer("fatal" in response
            ? { signature, quote: null, error: response.fatal }
            : { signature, quote: response.quote, error: null });
        })
        .catch(() => {
          if (!cancelled) setAnswer({ signature, quote: null, error: "Você está sem internet. Assim que voltar, a gente continua." });
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature]);

  // Enquanto uma sacola mais nova está sendo calculada, os números anteriores ficam na tela.
  if (!answer || answer.signature !== signature) return { status: "loading", quote: answer?.quote ?? null };
  if (answer.error || !answer.quote) return { status: "error", quote: null, message: answer.error ?? "" };
  return { status: "ready", quote: answer.quote };
}
