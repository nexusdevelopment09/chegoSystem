import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { requireRole } from "@/lib/auth/session";
import { signOut } from "../entrar/actions";

export const metadata: Metadata = { title: "Painel do admin" };

// Placeholder panel that proves the role check works. The real screens are Etapa 9.
export default function AdminPage() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Logo size={36} />
        <form action={signOut}>
          <Button type="submit" variant="secondary" className="min-h-11 px-5">
            Sair
          </Button>
        </form>
      </header>

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
      <h1 className="mb-2 text-3xl">Oi, {profile.fullName || "admin"}!</h1>
      <p className="text-coffee-soft">
        Você entrou como administrador. As telas de lojas, pedidos, cupons e
        configurações chegam nas próximas etapas.
      </p>
    </section>
  );
}
