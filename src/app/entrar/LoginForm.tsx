"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { signIn, type LoginState } from "./actions";

const inputClass =
  "min-h-12 w-full rounded-2xl border-2 border-peach bg-white px-4 text-base text-coffee placeholder:text-coffee-soft/70 focus:border-brand-dark focus:outline-none";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Usuário ou e-mail
        <input
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Senha
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>

      <p role="alert" aria-live="polite" className="min-h-5 text-sm font-semibold text-brand-darker">
        {state.error}
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
