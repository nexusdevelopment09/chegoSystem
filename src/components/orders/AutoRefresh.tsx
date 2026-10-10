"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Lê a página de novo no servidor a cada poucos segundos, para o status do pedido e
 * os pedidos novos aparecerem sozinhos. Pausa enquanto a aba está escondida.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
