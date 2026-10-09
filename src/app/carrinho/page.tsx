import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { CartView } from "./CartView";

export const metadata: Metadata = { title: "Sacola" };

export default function CartPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <h1 className="mb-3 text-3xl">Sua sacola</h1>
        <CartView />
      </main>
    </>
  );
}
