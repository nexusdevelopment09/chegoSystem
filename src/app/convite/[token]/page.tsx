import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getCurrentProfile } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { hashInvite } from "@/lib/merchant/invites";
import { AcceptInviteForm } from "./AcceptInviteForm";

export const metadata: Metadata = { title: "Convite para a equipe", robots: { index: false } };

type Params = Promise<{ token: string }>;

export default function InvitePage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pb-10 pt-4">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <Invite params={params} />
        </Suspense>
      </main>
    </>
  );
}

async function Invite({ params }: { params: Params }) {
  const { token } = await params;
  // Validade pelo relógio do app (o mesmo que calculou o vencimento ao criar o convite).
  const at = await now();
  const [invite] = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await sql<{ store_name: string; full_name: string; phone: string | null; role: "attendant" | "courier"; expires_at: Date }[]>`
        select s.name as store_name, i.full_name, i.phone, i.role, i.expires_at from store_invites i join stores s on s.id = i.store_id
        where i.token_hash = ${hashInvite(token)} and i.used_at is null and i.revoked_at is null and i.expires_at > ${at}`
    : [];
  if (!invite) {
    return (
      <div role="status" className="rounded-card bg-white p-6 text-center ring-1 ring-peach" data-testid="invite-invalid">
        <h1 className="text-2xl">Convite inválido</h1>
        <p className="mt-2 text-coffee-soft">Este convite já foi usado, foi cancelado ou venceu. Peça um novo para a loja.</p>
        <Link href="/" className="mt-3 inline-flex min-h-11 items-center font-bold text-brand-dark underline">Ir para o Chegô</Link>
      </div>
    );
  }
  const profile = await getCurrentProfile();
  return (
    <div className="flex flex-col gap-3 rounded-card bg-white p-5 ring-1 ring-peach">
      <h1 className="text-2xl">Você foi convidado para a {invite.store_name}</h1>
      <p className="text-coffee-soft">
        Como {invite.role === "courier" ? "entregador da loja" : "funcionário"}. Convite para {invite.full_name}, válido até {formatDateTime(invite.expires_at)} e só pode ser usado uma vez.
      </p>
      <AcceptInviteForm token={token} loggedAs={profile?.fullName ?? null} name={invite.full_name} phone={invite.phone} />
    </div>
  );
}
