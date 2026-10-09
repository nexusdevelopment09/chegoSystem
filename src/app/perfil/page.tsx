import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Button } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth/session";
import { formatPhone } from "@/lib/format";
import { signOutEverywhere } from "./actions";

export const metadata: Metadata = { title: "Meu perfil" };

export default function ProfilePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <ProfileContent />
        </Suspense>
      </main>
    </>
  );
}

async function ProfileContent() {
  const profile = await requireUser();

  return (
    <section className="flex flex-col gap-4 rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
      <h1 className="text-3xl">Meu perfil</h1>
      {profile.blocked && (
        <p role="status" className="rounded-2xl bg-peach px-4 py-3 font-semibold text-danger">
          Sua conta está bloqueada para novos pedidos. Fale com o suporte.
        </p>
      )}
      <dl className="grid gap-3">
        <div>
          <dt className="text-sm text-coffee-soft">Nome</dt>
          <dd className="text-lg font-semibold">{profile.fullName}</dd>
        </div>
        <div>
          <dt className="text-sm text-coffee-soft">Telefone</dt>
          <dd className="text-lg font-semibold">{profile.phone ? formatPhone(profile.phone) : "Não informado"}</dd>
        </div>
      </dl>
      <form action={signOutEverywhere}>
        <Button type="submit" variant="secondary">Sair de todos os aparelhos</Button>
      </form>
    </section>
  );
}
