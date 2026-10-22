"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };

/**
 * Menu do super admin: lateral no computador, faixa rolável no celular. O item da página aberta fica
 * destacado. "Painel" só fica ativo na própria página inicial do admin.
 */
export function AdminNav({ main, more }: { main: NavLink[]; more: NavLink[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  const item = (link: NavLink, index?: number) => {
    const active = isActive(link.href);
    return (
      <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
        className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 lg:rounded-2xl lg:ring-0 ${
          active ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach hover:bg-peach/40 lg:bg-transparent"}`}>
        {index !== undefined && <span className={`hidden w-5 text-right text-xs tabular-nums lg:inline ${active ? "text-white/80" : "text-coffee-soft"}`}>{index + 1}.</span>}
        {link.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Painel do admin" className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-4 lg:flex-col lg:gap-0.5 lg:overflow-visible">
      {main.map((link, index) => item(link, index))}
      <p className="hidden px-4 pt-3 text-xs font-bold uppercase text-coffee-soft lg:block">Mais</p>
      {more.map((link) => item(link))}
    </nav>
  );
}
