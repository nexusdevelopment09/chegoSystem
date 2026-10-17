"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError } from "@/components/ui/Field";
import { signInWithPhone, type PhoneSignInState } from "./actions";

const initialState: PhoneSignInState = {};

/** Telefone e senha: a mesma entrada para cliente, lojista e entregador. `area` diz de qual tela veio. */
export function PhonePasswordForm({ autoFocus = false, area = "customer" }: { autoFocus?: boolean; area?: "customer" | "store" | "courier" }) {
  const [state, formAction, pending] = useActionState(signInWithPhone, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="area" value={area} />
      <Field
        label="Seu telefone com DDD"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="(82) 90000-0000"
        defaultValue={state.phone}
        required
        autoFocus={autoFocus}
      />
      <Field label="Senha" name="password" type="password" autoComplete="current-password" required maxLength={72} />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
