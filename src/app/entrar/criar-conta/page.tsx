import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { currentLegalDocuments, slugOfLegalType } from "@/lib/legal";
import { CreateAccountForm } from "../CreateAccountForm";

export const metadata: Metadata = { title: "Criar conta" };

export default function CreateAccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Link href="/entrar" aria-label="Voltar para a entrada do Chegô" className="self-center">
        <LogoIcon size={64} title="Chegô" />
      </Link>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <h1 className="mb-1 text-2xl">Criar minha conta</h1>
        <p className="mb-6 text-sm text-coffee-soft">É rapidinho, e você já sai pedindo.</p>
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <AccountForm />
        </Suspense>
      </section>

      <Link href="/entrar" className="text-center text-sm font-semibold text-brand-dark underline">
        Já tenho conta
      </Link>
    </main>
  );
}

async function AccountForm() {
  await connection();
  // Termos de Uso e Política de Privacidade; os Termos do Lojista ficam para quem vende.
  const documents = (await currentLegalDocuments())
    .filter((document) => document.type !== "merchant_terms")
    .map((document) => ({ slug: slugOfLegalType(document.type), title: document.title }));
  return <CreateAccountForm documents={documents} />;
}
