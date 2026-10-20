import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { paymentCollection } from "@/lib/payments/collection";
import { withUser } from "@/lib/db";
import { getFeatureFlag } from "@/lib/settings";
import { getShoppingContext, listCities } from "@/lib/shopping-context";
import { CheckoutForm, type SavedAddress } from "./CheckoutForm";

export const metadata: Metadata = { title: "Finalizar pedido" };

export default function CheckoutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <h1 className="mb-3 text-3xl">Finalizar pedido</h1>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <CheckoutContent />
        </Suspense>
      </main>
    </>
  );
}

async function CheckoutContent() {
  // Sem conta também dá para pedir (pagando direto à loja): nome, telefone e endereço vão no pedido.
  const visitor = !(await getCurrentProfile()) && paymentCollection() === "store";
  const profile = visitor ? null : await requireUser();
  const [context, cities, cardEnabled] = await Promise.all([getShoppingContext(), listCities(), getFeatureFlag("card_payments")]);

  // Roda como o cliente: as regras de acesso por linha (RLS) devolvem só os endereços dele.
  const addresses = !profile ? [] : await withUser(profile.id, (tx) => tx<SavedAddress[]>`
    select a.id, a.street, a.number, a.reference, n.name as neighborhood, a.neighborhood_id as "neighborhoodId", a.is_default as "isDefault"
    from addresses a join neighborhoods n on n.id = a.neighborhood_id
    where a.deleted_at is null
    order by a.is_default desc, a.created_at desc`);

  const city = cities.find((item) => item.id === context.city?.id) ?? cities[0];

  return (
    <CheckoutForm
      addresses={[...addresses]}
      neighborhoods={city?.neighborhoods ?? []}
      cardEnabled={cardEnabled}
      blocked={profile?.blocked ?? false}
      guest={visitor}
    />
  );
}
