import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { signOut } from "@/app/entrar/actions";
import { Logo } from "@/components/brand/Logo";
import { CartSync } from "@/components/cart/CartSync";
import { Button, buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getCurrentProfile } from "@/lib/auth/session";
import { sql } from "@/lib/db";

const small = "min-h-11 px-3 text-sm sm:px-4";

/**
 * Barra do topo de todas as páginas: logo à esquerda, quem entrou à direita. A página
 * inicial passa a busca e o endereço em `children`: no computador eles ficam no meio
 * da barra; no celular, numa linha própria logo abaixo.
 */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={children ? "border-b border-peach/70 bg-white/70" : ""}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3">
        <Link href="/" aria-label="Chegô, página inicial" className="shrink-0">
          <Logo size={36} />
        </Link>
        {children && (
          <div className="order-last flex w-full min-w-0 flex-col gap-3 md:order-none md:w-auto md:flex-1 md:flex-row md:items-center md:justify-center">
            {children}
          </div>
        )}
        <Suspense fallback={<div className="h-11 w-24 animate-pulse rounded-full bg-peach" />}>
          <UserArea />
        </Suspense>
      </div>
    </header>
  );
}

// Cada opção leva à entrada que já existe. Quem pode o quê é decidido no servidor pelo perfil da
// conta, nunca pela opção escolhida aqui; administrador não tem cadastro público.
const SIGN_IN_OPTIONS = [
  { href: "/entrar", label: "Cliente", note: "Telefone e senha" },
  { href: "/entrar/loja", label: "Lojista", note: "Painel da loja" },
  { href: "/entrar/entregador", label: "Entregador", note: "Minhas entregas" },
  { href: "/entrar/senha", label: "Administrador", note: "Equipe Chegô" },
];

/** "Entrar" no canto superior direito: um menu com as entradas de cada perfil. */
function SignInMenu() {
  return (
    <details className="group relative" data-testid="signin-menu">
      <summary className={buttonClass("secondary", `${small} cursor-pointer list-none [&::-webkit-details-marker]:hidden`)}>
        Entrar
        <Icon name="chevronDown" size={16} className="ml-1 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="absolute right-0 z-30 mt-2 flex w-60 flex-col gap-1 rounded-card bg-white p-2 shadow-lg ring-1 ring-peach">
        {SIGN_IN_OPTIONS.map((option) => (
          <li key={option.href}>
            <Link href={option.href} className="flex min-h-11 flex-col justify-center rounded-2xl px-3 py-2 hover:bg-peach/40">
              <span className="font-bold">{option.label}</span>
              <span className="text-xs text-coffee-soft">{option.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

async function UserArea() {
  const profile = await getCurrentProfile();

  if (!profile) return <SignInMenu />;

  const [{ unread }] = await sql<{ unread: number }[]>`
    select count(*)::int as unread from notifications where profile_id = ${profile.id} and read_at is null`;

  const panel =
    profile.role === "admin"
      ? { href: "/admin", label: "Painel" }
      : profile.role === "merchant"
        ? { href: "/lojista", label: "Minha loja" }
        : profile.role === "courier"
          ? { href: "/entregador", label: "Entregas" }
          : { href: "/perfil", label: "Perfil" };

  return (
    <nav aria-label="Sua conta" className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
      {profile.role === "customer" && <CartSync />}
      <span className="hidden text-sm text-coffee-soft sm:inline" data-testid="user-greeting">
        Oi, {profile.fullName.split(" ")[0] || "você"}
      </span>
      <Link href="/notificacoes" data-testid="bell" aria-label={unread > 0 ? `Notificações: ${unread} não lida${unread > 1 ? "s" : ""}` : "Notificações"}
        className={buttonClass("secondary", "relative min-h-11 px-3 text-sm")}>
        <Icon name="bell" size={20} />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
      {profile.role === "customer" && (
        <Link href="/pedidos" className={buttonClass("secondary", small)}>
          Pedidos
        </Link>
      )}
      <Link href={panel.href} className={buttonClass("secondary", small)}>
        {panel.label}
      </Link>
      {profile.role !== "customer" && (
      <form action={signOut}>
        <Button type="submit" variant="secondary" className={small}>
          Sair
        </Button>
      </form>
      )}
    </nav>
  );
}
