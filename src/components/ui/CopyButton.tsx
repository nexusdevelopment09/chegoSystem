"use client";

import { useState } from "react";
import { Button } from "./Button";

/** Copia um texto (ex.: o Pix "copia e cola") e confirma na tela. */
export function CopyButton({ text, label = "Copiar código" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          // Sem permissão para a área de transferência: o código continua visível para copiar à mão.
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copiado!" : label}</span>
    </Button>
  );
}
