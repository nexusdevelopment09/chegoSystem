import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireStoreMember } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Minha loja" };

// The panel opens on what each role works with: orders, or deliveries for couriers.
export default function MerchantPage() {
  return (
    <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
      <MerchantHome />
    </Suspense>
  );
}

async function MerchantHome() {
  const { membership } = await requireStoreMember(["owner", "attendant", "courier"]);
  redirect(membership.role === "courier" ? "/lojista/entregas" : "/lojista/pedidos");
  return null;
}
