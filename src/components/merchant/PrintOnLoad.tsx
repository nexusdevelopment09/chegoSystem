"use client";

import { useEffect } from "react";

/** Abre a janela de impressão do navegador assim que o comprovante aparece na tela. */
export function PrintOnLoad() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
