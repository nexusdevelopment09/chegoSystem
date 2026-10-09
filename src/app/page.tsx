import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { buttonClass } from "@/components/ui/Button";

// Placeholder home. The real storefront (categories, stores, search) is Etapa 4.
export default function Home() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" aria-label="Chegô, página inicial">
          <Logo size={40} />
        </Link>
        <Link href="/entrar" className={buttonClass("secondary", "min-h-11 px-5")}>
          Entrar
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
        <LogoIcon size={112} title="Chegô" />
        <h1 className="text-4xl font-bold sm:text-5xl">Pediu, Chegô.</h1>
        <p className="max-w-md text-lg text-coffee-soft">
          Tudo da cidade, numa sacola só. As lojas de Joaquim Gomes estão
          arrumando as prateleiras, já já abre.
        </p>
      </main>

      <footer className="px-4 py-6 text-center text-sm text-coffee-soft">
        Chegô · Joaquim Gomes, AL
      </footer>
    </>
  );
}
