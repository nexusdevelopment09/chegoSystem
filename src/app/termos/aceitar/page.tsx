import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/brand/Logo";
import { TermsForm } from "@/app/cadastro/TermsForm";
import { homeFor } from "@/lib/auth/home";
import { getCurrentProfile } from "@/lib/auth/session";
import { pendingLegalDocuments, slugOfLegalType } from "@/lib/legal";

export const metadata: Metadata = { title: "Termos atualizados" };

// Shown on the next visit after a new version of the terms is published.
export default function AcceptTermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="self-center">
        <Logo size={56} />
      </div>
      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <h1 className="mb-1 text-2xl">Atualizamos nossos termos</h1>
        <p className="mb-6 text-sm text-coffee-soft">Dá uma olhada e aceite para continuar usando o Chegô.</p>
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <AcceptContent />
        </Suspense>
      </section>
    </main>
  );
}

async function AcceptContent() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (!profile.fullName) redirect("/cadastro");

  const pending = await pendingLegalDocuments(profile.id, profile.role);
  // Nothing left to accept (e.g. the browser came back here from its cache): go on.
  if (pending.length === 0) redirect(homeFor(profile.role));

  return (
    <TermsForm
      mode="terms"
      documents={pending.map((document) => ({
        slug: slugOfLegalType(document.type), title: document.title, version: document.version,
      }))}
    />
  );
}
