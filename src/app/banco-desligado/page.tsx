import type { Metadata } from "next";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Banco de dados desligado" };

// Mostrada pelo proxy (só no ambiente local) quando o banco de dados não responde.
export default function DatabaseOfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center">
      <LogoIcon size={72} />
      <h1 className="text-3xl">Banco de dados local desligado.</h1>
      <p className="text-lg text-coffee-soft">
        Abra o Docker Desktop e rode no terminal:
      </p>
      <code className="rounded-2xl bg-coffee px-5 py-3 text-lg font-bold text-peach">
        npm run db:start
      </code>
      <p className="text-sm text-coffee-soft">
        Na primeira vez, rode também <strong>npm run db:reset</strong> para
        criar as tabelas e os dados de teste.
      </p>
      {/* Link comum de propósito: recarregar a página inteira refaz a checagem do banco. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className={buttonClass("primary")}>
        Tentar de novo
      </a>
    </main>
  );
}
