"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type InstallPrompt = Event & { prompt: () => Promise<void> };

/** "Instalar o app": só aparece quando o navegador diz que o PWA pode ser instalado. */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!prompt) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        await prompt.prompt();
        setPrompt(null);
      }}
    >
      Instalar o app
    </Button>
  );
}
