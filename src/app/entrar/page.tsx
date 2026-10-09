import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { isLocalEnv } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar" };

// Password login for the admin (and, from Etapa 3, merchants). Customers will
// sign in with phone + SMS code, also built in Etapa 3.
export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-10">
      <Link href="/" aria-label="Chegô, página inicial" className="self-center">
        <Logo size={56} />
      </Link>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <h1 className="mb-1 text-2xl">Entrar</h1>
        <p className="mb-6 text-sm text-coffee-soft">
          Acesso do painel da plataforma.
        </p>
        <LoginForm />
      </section>

      {isLocalEnv && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-center text-sm text-coffee">
          Ambiente de testes: usuário <strong>admin</strong>, senha{" "}
          <strong>admin</strong>.
        </p>
      )}
    </main>
  );
}
