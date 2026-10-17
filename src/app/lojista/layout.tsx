import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getMerchantContext } from "@/lib/merchant/context";

const LINKS = [
  { href: "/lojista/pedidos", label: "Pedidos", roles: ["owner", "attendant"] },
  { href: "/lojista/entregas", label: "Entregas", roles: ["owner", "attendant", "courier"] },
  { href: "/lojista/cardapio", label: "Cardápio", roles: ["owner", "attendant"] },
  { href: "/lojista/loja", label: "Minha loja", roles: ["owner"] },
  { href: "/lojista/cupons", label: "Cupons", roles: ["owner"] },
  { href: "/lojista/avaliacoes", label: "Avaliações", roles: ["owner", "attendant"] },
  { href: "/lojista/relatorios", label: "Relatórios", roles: ["owner"] },
  { href: "/lojista/taxas", label: "Taxas do Chegô", roles: ["owner"] },
  { href: "/lojista/financeiro", label: "Financeiro", roles: ["owner"] },
  { href: "/lojista/divulgacao", label: "Divulgação", roles: ["owner"] },
  { href: "/perfil", label: "Minha conta", roles: ["owner", "attendant", "courier"] },
];

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="print:hidden">
        <SiteHeader />
        <Suspense fallback={<div className="mx-auto h-11 w-full max-w-6xl animate-pulse bg-peach" />}>
          <MerchantNav />
        </Suspense>
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 print:max-w-none print:p-0">{children}</main>
    </>
  );
}

async function MerchantNav() {
  const { membership, store } = await getMerchantContext(["owner", "attendant", "courier"]);
  return (
    <nav aria-label="Painel da loja" className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-4 pb-1">
      <span className="flex min-h-11 shrink-0 items-center pr-2 font-display text-lg font-semibold">{store.name}</span>
      {LINKS.filter((link) => link.roles.includes(membership.role)).map((link) => (
        <Link key={link.href} href={link.href} className="flex min-h-11 shrink-0 items-center rounded-full bg-white px-4 text-sm font-bold ring-1 ring-peach hover:ring-brand">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
