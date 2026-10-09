import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Painel do admin" };

// Placeholder panel that proves the role check works. The real screens are Etapa 11.
export default function AdminPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <AdminWelcome />
        </Suspense>
      </main>
    </>
  );
}

async function AdminWelcome() {
  const profile = await requireRole("admin");

  return (
    <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
      <h1 className="mb-2 text-3xl">Oi, {profile.fullName}!</h1>
      <p className="text-coffee-soft">
        Você entrou como administrador. As telas de lojas, pedidos, cupons e
        configurações chegam nas próximas etapas.
      </p>
    </section>
  );
}
