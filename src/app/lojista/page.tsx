import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { STORE_ROLE_LABELS } from "@/lib/labels";
import { getStoreMemberships, requireStoreMember } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Minha loja" };

// Placeholder that proves the store roles work. The real panel is Etapa 8.
export default function MerchantPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
          <MerchantWelcome />
        </Suspense>
      </main>
    </>
  );
}

async function MerchantWelcome() {
  const { profile } = await requireStoreMember(["owner", "attendant", "courier"]);
  const memberships = await getStoreMemberships(profile.id);

  return (
    <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
      <h1 className="mb-4 text-3xl">Oi, {profile.fullName.split(" ")[0]}!</h1>
      <ul className="flex flex-col gap-2">
        {memberships.map((membership) => (
          <li key={membership.storeId} className="rounded-2xl bg-cream px-4 py-3">
            <strong>{membership.storeName}</strong> · {STORE_ROLE_LABELS[membership.role]}
          </li>
        ))}
      </ul>
    </section>
  );
}
