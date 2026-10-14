"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError } from "@/components/ui/Field";
import { createCustomerAccount, type CreateAccountState } from "./actions";

const initialState: CreateAccountState = {};

export function CreateAccountForm({ documents }: { documents: { slug: string; title: string }[] }) {
  const [state, formAction, pending] = useActionState(createCustomerAccount, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Seu nome completo" name="fullName" autoComplete="name" required minLength={3} maxLength={80} defaultValue={state.fullName} autoFocus />
      <Field
        label="Seu telefone com DDD"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="(82) 90000-0000"
        defaultValue={state.phone}
        required
      />
      <Field
        label="Crie uma senha"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={72}
        hint="Pelo menos 8 caracteres. Você vai usar o telefone e esta senha para entrar."
      />

      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="accepted" required className="mt-1 size-5 shrink-0 accent-brand-dark" />
        <span>
          Li e aceito{" "}
          {documents.map((document, index) => (
            <span key={document.slug}>
              {index > 0 && (index === documents.length - 1 ? " e " : ", ")}
              <Link href={`/termos/${document.slug}`} target="_blank" className="font-bold text-brand-dark underline">
                {document.title}
              </Link>
            </span>
          ))}
          .
        </span>
      </label>

      <FormError message={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando..." : "Criar minha conta"}
      </Button>
    </form>
  );
}
