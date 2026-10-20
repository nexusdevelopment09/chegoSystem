"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { acceptInvite, type AcceptState } from "./actions";

export function AcceptInviteForm({ token, loggedAs, name, phone }: { token: string; loggedAs: string | null; name: string; phone: string | null }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvite, {});
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="accept-invite">
      <input type="hidden" name="token" value={token} />
      {loggedAs ? (
        <p className="text-sm">Você está na conta de <strong>{loggedAs}</strong>. Aceite para entrar na equipe com ela.</p>
      ) : (
        <>
          <p className="text-sm text-coffee-soft">Crie seu acesso. Já tem conta no Chegô? Entre com ela e abra este link de novo.</p>
          <Field label="Nome completo" name="fullName" defaultValue={name} required maxLength={80} />
          <Field label="Telefone com DDD" name="phone" inputMode="tel" defaultValue={phone ?? ""} required />
          <Field label="Crie uma senha" name="password" type="password" autoComplete="new-password" required minLength={8} hint="Pelo menos 8 caracteres." />
        </>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Entrando..." : "Aceitar convite"}</Button>
      {state.error && <p role="alert" className="text-sm font-bold text-danger">{state.error}</p>}
    </form>
  );
}
