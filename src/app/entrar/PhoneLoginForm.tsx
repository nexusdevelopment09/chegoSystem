"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError } from "@/components/ui/Field";
import { formatPhone } from "@/lib/format";
import { phoneLogin, type PhoneLoginState } from "./actions";

const initialState: PhoneLoginState = { step: "phone" };

export function PhoneLoginForm() {
  const [state, formAction, pending] = useActionState(phoneLogin, initialState);

  if (state.step === "code" && state.phone) {
    return (
      <form action={formAction} className="flex flex-col gap-4">
        <p className="text-coffee-soft">
          Mandamos um código por SMS para <strong className="text-coffee">{formatPhone(state.phone)}</strong>.
        </p>
        <input type="hidden" name="phone" value={state.phone} />
        <Field
          label="Código de 6 números"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="text-center text-2xl tracking-[0.4em]"
        />
        <FormError message={state.error} />
        <Button type="submit" name="intent" value="verify" disabled={pending}>
          {pending ? "Conferindo..." : "Entrar"}
        </Button>
        {/* Link comum de propósito: recarregar a página inteira volta ao passo do telefone. */}
        <a href="/entrar" className="text-center text-sm font-semibold text-brand-dark underline">
          Usar outro telefone
        </a>
      </form>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        label="Seu telefone com DDD"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="(82) 90000-0000"
        required
        autoFocus
      />
      <FormError message={state.error} />
      <Button type="submit" name="intent" value="send" disabled={pending}>
        {pending ? "Enviando..." : "Receber código"}
      </Button>
    </form>
  );
}
