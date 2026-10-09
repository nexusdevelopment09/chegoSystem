import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/brand/Logo";
import { getCurrentProfile } from "@/lib/auth/session";
import { pendingLegalDocuments, slugOfLegalType } from "@/lib/legal";
import { TermsForm } from "./TermsForm";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="self-center">
        <Logo size={56} />
      </div>
      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
        <h1 className="mb-1 text-2xl">Falta pouco!</h1>
        <p className="mb-6 text-sm text-coffee-soft">Como a gente te chama?</p>
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <SignupContent />
        </Suspense>
      </section>
    </main>
  );
}

async function SignupContent() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");
  if (profile.fullName) redirect("/termos/aceitar");

  const pending = await pendingLegalDocuments(profile.id, profile.role);
  return (
    <TermsForm
      mode="signup"
      documents={pending.map((document) => ({
        slug: slugOfLegalType(document.type), title: document.title, version: document.version,
      }))}
    />
  );
}
