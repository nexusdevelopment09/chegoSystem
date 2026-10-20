import { Suspense, type ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { PrintStation } from "@/components/merchant/PrintStation";
import { hasPermission } from "@/lib/auth/session";
import { getMerchantContext } from "@/lib/merchant/context";
import type { Permission } from "@/lib/merchant/permissions";
import { listPrinters } from "@/lib/printing/jobs";
import { NavLinks } from "./NavLinks";

// Cada atalho aparece para quem tem a permissão dele (o dono vê todos). "courier" = só o entregador da loja.
const LINKS: { href: string; label: string; perm?: Permission; courier?: boolean }[] = [
  { href: "/lojista/painel", label: "Resumo", perm: "dashboard.ver" },
  { href: "/lojista/pedidos", label: "Pedidos", perm: "pedidos.ver" },
  { href: "/lojista/mesas", label: "Mesas e balcão", perm: "vendas.presenciais" },
  { href: "/lojista/entregas", label: "Entregas", perm: "pedidos.ver", courier: true },
  { href: "/lojista/cardapio", label: "Cardápio", perm: "produtos.ver" },
  { href: "/lojista/estoque", label: "Estoque", perm: "estoque.ver" },
  { href: "/lojista/relatorios", label: "Relatórios", perm: "relatorios.ver" },
  { href: "/lojista/equipe", label: "Funcionários", perm: "equipe.gerenciar" },
  { href: "/lojista/entregadores", label: "Entregadores", perm: "entregadores.ver" },
  { href: "/lojista/auditoria", label: "Auditoria", perm: "auditoria.ver" },
  { href: "/lojista/loja", label: "Minha loja", perm: "loja.config" },
  { href: "/lojista/cupons", label: "Cupons", perm: "loja.config" },
  { href: "/lojista/avaliacoes", label: "Avaliações", perm: "pedidos.ver" },
  { href: "/lojista/impressoras", label: "Impressoras", perm: "pedidos.ver" },
  { href: "/lojista/taxas", label: "Taxas do Chegô", perm: "financeiro.ver" },
  { href: "/lojista/financeiro", label: "Financeiro", perm: "financeiro.ver" },
  { href: "/lojista/divulgacao", label: "Divulgação", perm: "loja.config" },
  { href: "/perfil", label: "Minha conta", courier: true },
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
      <Suspense fallback={null}>
        <Station />
      </Suspense>
    </>
  );
}

/** A estação de impressão Bluetooth, no celular onde a impressora foi conectada. */
async function Station() {
  const { membership, store } = await getMerchantContext(["owner", "attendant", "courier"]);
  if (membership.role === "courier") return null;
  const printers = await listPrinters(store.id);
  return <PrintStation printers={printers.map((printer) => ({ id: printer.id, name: printer.name, deviceId: printer.device_id, autoPrint: printer.auto_print }))} />;
}

async function MerchantNav() {
  const { membership, store } = await getMerchantContext(["owner", "attendant", "courier"]);
  return (
    <nav aria-label="Painel da loja" className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-4 pb-1">
      <span className="flex min-h-11 shrink-0 items-center pr-2 font-display text-lg font-semibold">{store.name}</span>
      <NavLinks links={LINKS.filter((link) => (membership.role === "courier" ? link.courier : !link.perm || hasPermission(membership, link.perm))).map(({ href, label }) => ({ href, label }))} />
    </nav>
  );
}
