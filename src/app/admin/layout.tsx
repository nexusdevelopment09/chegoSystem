import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";

const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/ao-vivo", label: "Ao vivo" },
  { href: "/admin/lojas", label: "Lojas" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/suporte", label: "Suporte" },
  { href: "/admin/moderacao", label: "Moderação" },
  { href: "/admin/financeiro", label: "Financeiro" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/cadastros", label: "Cadastros" },
  { href: "/admin/configuracoes", label: "Configurações" },
  { href: "/admin/auditoria", label: "Auditoria" },
];

// Cada página dentro de /admin confere o papel de admin por conta própria (requireRole),
// então o layout só desenha o menu.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <nav aria-label="Painel do admin" className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-4 pb-1">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="flex min-h-11 shrink-0 items-center rounded-full bg-white px-4 text-sm font-bold ring-1 ring-peach hover:ring-brand">
            {link.label}
          </Link>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">{children}</main>
    </>
  );
}
