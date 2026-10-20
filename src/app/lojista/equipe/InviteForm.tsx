"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, inputClass } from "@/components/ui/Field";
import { createInvite, type ActionState } from "./actions";

type Group = { group: string; items: { key: string; label: string }[] };

/** Convidar alguém: o link de uso único aparece uma vez, para copiar e mandar. */
export function InviteForm({ groups, allowed, defaultRole = "attendant", roles = ["attendant", "courier"] }: {
  groups: Group[];
  /** Permissões que quem convida pode dar (as que ele mesmo tem). */
  allowed: string[];
  defaultRole?: "attendant" | "courier";
  roles?: ("attendant" | "courier")[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createInvite, {});
  const [custom, setCustom] = useState(false);
  const [role, setRole] = useState(defaultRole);
  const link = state.link && typeof window !== "undefined" ? `${window.location.origin}${state.link}` : state.link;

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" data-testid="invite-form">
      <Field label="Nome completo" name="name" required maxLength={80} />
      <Field label="Telefone (opcional)" name="phone" inputMode="tel" hint="Se informar, só esse telefone poderá usar o convite." />
      {roles.length > 1 ? (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Função
          <select name="role" value={role} onChange={(event) => setRole(event.target.value as typeof role)} className={inputClass}>
            <option value="attendant">Funcionário (atendente)</option>
            <option value="courier">Entregador da loja</option>
          </select>
        </label>
      ) : <input type="hidden" name="role" value={roles[0]} />}
      {role === "attendant" && (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" name="customPermissions" checked={custom} onChange={(event) => setCustom(event.target.checked)} className="size-5 accent-brand-dark" />
          Escolher as permissões (senão, as padrão de atendente)
        </label>
      )}
      {custom && role === "attendant" && (
        <fieldset className="grid gap-2 rounded-2xl bg-cream p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="text-sm font-semibold">Permissões</legend>
          {groups.map((group) => (
            <div key={group.group}>
              <p className="text-xs font-bold uppercase text-coffee-soft">{group.group}</p>
              {group.items.map((item) => (
                <label key={item.key} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="permissions" value={item.key} disabled={!allowed.includes(item.key)} className="size-5 accent-brand-dark" />
                  {item.label}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      )}
      <Button type="submit" disabled={pending} className="self-start sm:col-span-2">{pending ? "Criando..." : "Criar convite"}</Button>
      {state.error && <p role="alert" className="text-sm font-bold text-danger sm:col-span-2">{state.error}</p>}
      {state.ok && link && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl bg-peach p-3 text-sm sm:col-span-2" data-testid="invite-link">
          <p className="font-semibold">{state.message}</p>
          <code className="break-all rounded-lg bg-white px-2 py-1">{link}</code>
          <CopyButton text={link} label="Copiar link" />
        </div>
      )}
    </form>
  );
}
