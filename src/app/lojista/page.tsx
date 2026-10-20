import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasPermission, requireStoreMember } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Minha loja" };

type SearchParams = Promise<{ negado?: string }>;

// O painel abre no que cada papel usa: pedidos, ou entregas para os entregadores. Depois de
// uma tentativa sem permissão, fica aqui mostrando o aviso (sem pular para outra tela).
export default function MerchantPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-coffee-soft">Carregando...</p>}>
      <MerchantHome searchParams={searchParams} />
    </Suspense>
  );
}

async function MerchantHome({ searchParams }: { searchParams: SearchParams }) {
  const [{ negado }, { membership }] = await Promise.all([searchParams, requireStoreMember(["owner", "attendant", "courier"])]);
  const home = membership.role === "courier" ? "/lojista/entregas" : hasPermission(membership, "pedidos.ver") ? "/lojista/pedidos" : hasPermission(membership, "dashboard.ver") ? "/lojista/painel" : null;
  if (negado !== "1" && home) redirect(home);

  return (
    <div role="alert" data-testid="access-denied" className="flex flex-col gap-3 rounded-card bg-white p-6 ring-1 ring-peach">
      <h1 className="text-2xl">{negado === "1" ? "Você não tem acesso a essa área" : "Nenhuma área liberada ainda"}</h1>
      <p className="text-coffee-soft">
        {negado === "1" ? "A tentativa ficou registrada. Se precisar, peça ao dono da loja para liberar a permissão." : "O dono da loja ainda não liberou nenhuma área para você."}
      </p>
      {home && <Link href={home} className="self-start rounded-full bg-brand-dark px-5 py-3 text-sm font-bold text-white">Voltar ao painel</Link>}
    </div>
  );
}
