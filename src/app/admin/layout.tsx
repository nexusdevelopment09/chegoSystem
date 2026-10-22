import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AdminNav } from "./AdminNav";

// A ordem pedida para o super admin; as outras áreas do admin continuam em "Mais".
const MAIN = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/lojas", label: "Lojas" },
  { href: "/admin/empresas", label: "Empresas" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/vendas", label: "Vendas e faturamento" },
  { href: "/admin/motoboys", label: "Motoboys" },
  { href: "/admin/anuncios", label: "Anúncios e impulsionamentos" },
  { href: "/admin/avaliacoes", label: "Avaliações" },
  { href: "/admin/suspensas", label: "Contas suspensas" },
  { href: "/admin/excluidas", label: "Empresas excluídas" },
  { href: "/admin/relatorios", label: "Relatórios" },
  { href: "/admin/auditoria", label: "Auditoria" },
  { href: "/admin/configuracoes", label: "Configurações" },
];

const MORE = [
  { href: "/admin/ao-vivo", label: "Ao vivo" },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/entregadores", label: "Cadastro de entregadores" },
  { href: "/admin/suporte", label: "Suporte" },
  { href: "/admin/moderacao", label: "Moderação" },
  { href: "/admin/taxas", label: "Taxas" },
  { href: "/admin/financeiro", label: "Financeiro" },
  { href: "/admin/simulador", label: "Simulador" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/cadastros", label: "Cadastros" },
];

// Cada página dentro de /admin confere o papel de admin por conta própria (requireRole) e as ações
// críticas conferem o super admin (requireSuperAdmin); o layout só desenha o menu.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 pb-8 lg:flex-row lg:items-start">
        <aside className="lg:w-60 lg:shrink-0">
          <AdminNav main={MAIN} more={MORE} />
        </aside>
        <main className="min-w-0 flex-1 py-2">{children}</main>
      </div>
    </>
  );
}
