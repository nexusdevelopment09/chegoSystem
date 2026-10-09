import Link from "next/link";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { buttonClass } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <LogoIcon size={72} />
      <h1 className="text-3xl">Oxe, essa página não existe.</h1>
      <p className="text-coffee-soft">O endereço pode estar errado ou a loja saiu do ar.</p>
      <Link href="/" className={buttonClass("primary")}>
        Ver as lojas
      </Link>
    </main>
  );
}
