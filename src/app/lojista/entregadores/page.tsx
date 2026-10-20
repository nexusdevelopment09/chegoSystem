import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDateTime, formatPhone } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { revokeInvite, revokeMemberSessions, setMemberActive } from "../equipe/actions";
import { InviteForm } from "../equipe/InviteForm";

export const metadata: Metadata = { title: "Entregadores" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";

export default function CouriersPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Couriers />
    </Suspense>
  );
}

async function Couriers() {
  const { membership, store } = await getMerchantContext("entregadores.ver");
  const canManage = hasPermission(membership, "entregadores.gerenciar");
  const [couriers, deliveries, invites] = await Promise.all([
    sql<{ id: string; full_name: string; phone: string | null; active: boolean; deactivated_at: Date | null; total: number; open: number; delivered30: number }[]>`
      select p.id, p.full_name, p.phone, m.active, m.deactivated_at,
             (select count(*)::int from orders o where o.store_id = m.store_id and o.courier_id = p.id) as total,
             (select count(*)::int from orders o where o.store_id = m.store_id and o.courier_id = p.id and o.status in ('accepted', 'preparing', 'ready', 'out_for_delivery')) as open,
             (select count(*)::int from orders o where o.store_id = m.store_id and o.courier_id = p.id and o.status = 'delivered' and o.completed_at > now() - interval '30 days') as delivered30
      from store_members m join profiles p on p.id = m.profile_id
      where m.store_id = ${store.id} and m.role = 'courier'
      order by m.active desc, p.full_name`,
    sql<{ id: string; code: string; status: OrderStatus; courier_id: string; dispatched_at: Date | null; completed_at: Date | null; neighborhood: string | null }[]>`
      select o.id, o.code, o.status, o.courier_id, o.dispatched_at, o.completed_at, n.name as neighborhood
      from orders o left join neighborhoods n on n.id = o.neighborhood_id
      where o.store_id = ${store.id} and o.courier_id in (select profile_id from store_members where store_id = ${store.id} and role = 'courier')
      order by o.created_at desc limit 200`,
    sql<{ id: string; full_name: string; expires_at: Date }[]>`
      select id, full_name, expires_at from store_invites where store_id = ${store.id} and role = 'courier' and used_at is null and revoked_at is null and expires_at > now() order by created_at desc`,
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header>
        <h1 className="text-3xl">Entregadores</h1>
        <p className="text-coffee-soft">
          Entregadores da própria loja. Com acesso ao Chegô, cada um vê só as entregas atribuídas a ele (endereço e contato do pedido), muda o status e
          confirma a entrega; nada de faturamento, estoque, outros entregadores ou configurações. O vínculo com o pedido é feito na tela do pedido.
        </p>
      </header>

      {canManage && (
        <section className={card}>
          <h2 className="text-xl">Cadastrar entregador</h2>
          <p className="-mt-2 text-sm text-coffee-soft">Gera um convite de uso único. Ele cria a senha e já cai na tela de entregas.</p>
          <InviteForm groups={[]} allowed={[]} defaultRole="courier" roles={["courier"]} />
          {invites.length > 0 && (
            <ul className="divide-y divide-cream text-sm">
              {invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>Convite para <strong>{invite.full_name}</strong> · vale até {formatDateTime(invite.expires_at)}</span>
                  <form action={revokeInvite}><input type="hidden" name="id" value={invite.id} /><Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">Cancelar convite</Button></form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {couriers.length === 0 ? (
        <p role="status" className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum entregador cadastrado.</p>
      ) : couriers.map((courier) => {
        const mine = deliveries.filter((order) => order.courier_id === courier.id).slice(0, 8);
        return (
          <section key={courier.id} className={`${card} ${courier.active ? "" : "opacity-75"}`} data-testid="courier-card" aria-label={courier.full_name}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl">{courier.full_name || "Ainda não entrou"}</h2>
                <p className="text-sm text-coffee-soft">
                  {courier.phone && `${formatPhone(courier.phone)} · `}{courier.active ? "Ativo" : `Desativado em ${formatDateTime(courier.deactivated_at!)}`}
                  {" · "}{courier.open} em andamento · {courier.delivered30} entregues em 30 dias · {courier.total} no total
                </p>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <form action={setMemberActive}>
                    <input type="hidden" name="profileId" value={courier.id} />
                    <input type="hidden" name="active" value={courier.active ? "0" : "1"} />
                    <Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">{courier.active ? "Desativar" : "Reativar"}</Button>
                  </form>
                  <form action={revokeMemberSessions}><input type="hidden" name="profileId" value={courier.id} /><Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">Encerrar sessões</Button></form>
                </div>
              )}
            </div>
            {mine.length > 0 ? (
              <ul className="divide-y divide-cream text-sm">
                {mine.map((order) => (
                  <li key={order.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span><Link href={`/lojista/pedidos/${order.id}`} className="font-semibold underline">{order.code}</Link>{order.neighborhood && ` · ${order.neighborhood}`}</span>
                    <span className="text-coffee-soft">{STATUS_LABELS[order.status]}{order.completed_at ? ` · ${formatDateTime(order.completed_at)}` : order.dispatched_at ? ` · saiu ${formatDateTime(order.dispatched_at)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-coffee-soft">Nenhuma entrega ainda.</p>}
          </section>
        );
      })}
    </div>
  );
}
