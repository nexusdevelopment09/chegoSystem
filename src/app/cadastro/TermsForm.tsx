"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError } from "@/components/ui/Field";
import { acceptTerms, completeSignup, type SignupState } from "@/app/entrar/actions";

const initialState: SignupState = {};

type TermsFormProps = {
  /** "signup" também pede o nome; "terms" só o aceite. */
  mode: "signup" | "terms";
  documents: { slug: string; title: string; version: number }[];
};

export function TermsForm({ mode, documents }: TermsFormProps) {
  const [state, formAction, pending] = useActionState(
    mode === "signup" ? completeSignup : acceptTerms,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {mode === "signup" && (
        <Field label="Seu nome completo" name="fullName" autoComplete="name" required minLength={3} maxLength={80} autoFocus />
      )}

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
        {pending ? "Salvando..." : mode === "signup" ? "Criar minha conta" : "Aceitar e continuar"}
      </Button>
    </form>
  );
}
