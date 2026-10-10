import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { isLocalEnv } from "@/lib/env";
import { LoginForm } from "../LoginForm";

export const metadata: Metadata = { title: "Entrar com senha" };

// Login por senha, mantido para a equipe da plataforma. Todos os outros usam telefone + código.
export default function PasswordLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" aria-label="Chegô, página inicial" className="self-center">
        <Logo size={56} />
      </Link>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <h1 className="mb-1 text-2xl">Entrar com senha</h1>
        <p className="mb-6 text-sm text-coffee-soft">Acesso da equipe da plataforma.</p>
        <LoginForm />
      </section>

      {isLocalEnv && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-center text-sm text-coffee">
          Ambiente de testes: usuário <strong>admin</strong>, senha <strong>admin</strong>.
        </p>
      )}

      <Link href="/entrar" className="text-center text-sm font-semibold text-brand-dark underline">
        Entrar com telefone
      </Link>
    </main>
  );
}
