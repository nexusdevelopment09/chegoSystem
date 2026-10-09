import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/entrar/actions";
import { Logo } from "@/components/brand/Logo";
import { Button, buttonClass } from "@/components/ui/Button";
import { getCurrentProfile } from "@/lib/auth/session";

const small = "min-h-11 px-4 text-sm";

/** Top bar of every page: logo on the left, who is signed in on the right. */
export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
      <Link href="/" aria-label="Chegô, página inicial">
        <Logo size={36} />
      </Link>
      <Suspense fallback={<div className="h-11 w-24 animate-pulse rounded-full bg-peach" />}>
        <UserArea />
      </Suspense>
    </header>
  );
}

async function UserArea() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <Link href="/entrar" className={buttonClass("secondary", small)}>
        Entrar
      </Link>
    );
  }

  const panel =
    profile.role === "admin"
      ? { href: "/admin", label: "Painel" }
      : profile.role === "merchant"
        ? { href: "/lojista", label: "Minha loja" }
        : { href: "/perfil", label: "Perfil" };

  return (
    <nav aria-label="Sua conta" className="flex items-center gap-2">
      <span className="hidden text-sm text-coffee-soft sm:inline" data-testid="user-greeting">
        Oi, {profile.fullName.split(" ")[0] || "você"}
      </span>
      <Link href={panel.href} className={buttonClass("secondary", small)}>
        {panel.label}
      </Link>
      <form action={signOut}>
        <Button type="submit" variant="secondary" className={small}>
          Sair
        </Button>
      </form>
    </nav>
  );
}
