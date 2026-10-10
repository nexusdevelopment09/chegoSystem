"use client";

import { useEffect } from "react";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { Button } from "@/components/ui/Button";

// Shown when a page fails. The user sees a friendly message; the technical
// error is logged (and on the server it is already in the server log).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <LogoIcon size={72} />
      <h1 className="text-3xl">Eita, deu um problema aqui.</h1>
      <p className="text-coffee-soft">Não foi nada que você fez. Tenta de novo; se continuar, volta daqui a pouco.</p>
      <Button type="button" onClick={reset}>Tentar de novo</Button>
      {error.digest && <p className="text-xs text-coffee-soft">Código do erro: {error.digest}</p>}
    </main>
  );
}
