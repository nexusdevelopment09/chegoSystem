import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { isLocalEnv } from "@/lib/env";
import { PhoneLoginForm } from "./PhoneLoginForm";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" aria-label="Chegô, página inicial" className="self-center">
        <Logo size={56} />
      </Link>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <h1 className="mb-1 text-2xl">Entrar ou cadastrar</h1>
        <p className="mb-6 text-sm text-coffee-soft">É rapidinho: só o telefone e um código.</p>
        <PhoneLoginForm />
      </section>

      {isLocalEnv && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-center text-sm text-coffee">
          Ambiente de testes: o código é sempre <strong>123456</strong>. Para entrar sem digitar nada,
          use o{" "}
          <Link href="/dev" className="font-bold underline">login rápido</Link>.
        </p>
      )}

      <Link href="/entrar/senha" className="text-center text-sm font-semibold text-brand-dark underline">
        Entrar com e-mail e senha
      </Link>
    </main>
  );
}
