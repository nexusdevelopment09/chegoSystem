"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Links do painel da loja; o da página aberta fica destacado. */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return links.map((link) => {
    const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold ring-1 ${
          active ? "bg-brand-dark text-white ring-brand-dark" : "bg-white ring-peach hover:ring-brand"
        }`}
      >
        {link.label}
      </Link>
    );
  });
}
