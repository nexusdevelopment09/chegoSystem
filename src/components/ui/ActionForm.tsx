"use client";

import { createContext, startTransition, use, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./Button";

export type ActionState = { error?: string; ok?: boolean; message?: string };
type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext<boolean | null>(null);

type Props = {
  action: Action;
  children: ReactNode;
  className?: string;
  /** Chamado uma vez cada vez que a ação dá certo (ex.: para abrir a janela de impressão). */
  onSuccess?: () => void;
  /** Limpa os campos depois de um sucesso (caixas de mensagem). */
  resetOnSuccess?: boolean;
};

/**
 * Um formulário ligado a uma server action que mostra a mensagem da ação embaixo dele.
 *
 * A ação é chamada à mão em vez de pelo atributo `action` do formulário,
 * porque isso limparia todos os campos quando a ação termina,
 * e perder o que você digitou por causa de um erro de validação é o pior
 * momento para perder. Os campos só são limpos no sucesso, quando pedido.
 */
export function ActionForm({ action, children, className, onSuccess, resetOnSuccess }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (!state.ok || handled.current === state) return;
    handled.current = state;
    if (resetOnSuccess) form.current?.reset();
    onSuccess?.();
  }, [state, onSuccess, resetOnSuccess]);

  return (
    <form
      ref={form}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        // O botão clicado vai junto, para o nome e o valor dele chegarem à ação.
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext value={pending}>{children}</PendingContext>
      {state.ok && state.message && (
        <p role="status" className="mt-1 w-full text-sm font-bold text-success">
          {state.message}
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-1 w-full text-sm font-bold text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

type SubmitProps = {
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  name?: string;
  value?: string;
};

/** Botão de enviar que se desabilita enquanto o formulário está sendo enviado. */
export function SubmitButton({ children, variant, className, name, value }: SubmitProps) {
  const fromActionForm = use(PendingContext);
  const { pending: fromPlainForm } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={className} name={name} value={value} disabled={fromActionForm ?? fromPlainForm}>
      {children}
    </Button>
  );
}
