"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { generateRandomOrder, resetDatabase, runTasksNow, type DevState } from "./actions";

const small = "min-h-11 px-4 text-sm";

/** Atalhos de um clique da página /dev. */
export function DevTools() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DevState | null>(null);
  const [resetState, resetAction, resetting] = useActionState(resetDatabase, {});

  const run = (action: () => Promise<DevState>) =>
    startTransition(async () => {
      setResult(null);
      try {
        setResult(await action());
      } catch {
        setResult({ error: "Não deu certo. Veja o terminal do npm run dev." });
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={small} disabled={pending} onClick={() => run(runTasksNow)}>Rodar tarefas agendadas agora</Button>
        <Button type="button" variant="secondary" className={small} disabled={pending} onClick={() => run(generateRandomOrder)}>Gerar pedido aleatório</Button>
      </div>
      {result && (
        <p role="status" data-testid="dev-result" className={`text-sm font-bold ${result.error ? "text-danger" : "text-success"}`}>
          {result.error ?? result.message}
        </p>
      )}
      <p className="text-sm text-coffee-soft">
        As tarefas (expirar Pix, recusar pedido sem aceite, lembretes, faturas) também rodam sozinhas a cada minuto enquanto o app está ligado.
      </p>

      <form action={resetAction} className="flex flex-wrap items-center gap-3 rounded-2xl bg-cream p-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="confirm" className="size-5 accent-brand-dark" />
          Quero apagar tudo e voltar aos dados de teste originais
        </label>
        <Button type="submit" variant="secondary" className={`${small} text-danger`} disabled={resetting}>
          {resetting ? "Recriando o banco..." : "Resetar banco"}
        </Button>
        {resetState.error && <p role="alert" className="w-full text-sm font-bold text-danger">{resetState.error}</p>}
      </form>
    </div>
  );
}
