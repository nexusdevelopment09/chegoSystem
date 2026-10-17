import "server-only";
import { redirect } from "next/navigation";
import { requireRole, type CurrentProfile } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import type { OrderStatus } from "@/lib/orders/status";
import type { Vehicle } from "@/lib/labels";

// A rede de entregadores do Chegô: os da própria plataforma ("platform") e os
// parceiros autônomos ("partner"). Não confundir com o entregador de uma loja,
// que é um membro da equipe dela (store_members).

/** Quantas entregas um entregador pode carregar ao mesmo tempo. */
export const MAX_ACTIVE_DELIVERIES = 2;

/** Enquanto o pedido está nestes status, um entregador da rede pode pegá-lo. */
export const OFFER_STATUSES: OrderStatus[] = ["accepted", "preparing", "ready"];

export type Courier = {
  profileId: string;
  kind: "platform" | "partner";
  status: "pending" | "active" | "blocked";
  cityId: string;
  cityName: string;
  vehicle: Vehicle;
  plate: string | null;
  available: boolean;
  blockedReason: string | null;
};

export async function getCourier(profileId: string): Promise<Courier | null> {
  const [row] = await sql<{
    profile_id: string; kind: Courier["kind"]; status: Courier["status"]; city_id: string; city_name: string;
    vehicle: Vehicle; plate: string | null; available: boolean; blocked_reason: string | null;
  }[]>`
    select c.profile_id, c.kind, c.status, c.city_id, ci.name as city_name, c.vehicle, c.plate, c.available, c.blocked_reason
    from couriers c join cities ci on ci.id = c.city_id
    where c.profile_id = ${profileId}`;
  if (!row) return null;
  return {
    profileId: row.profile_id, kind: row.kind, status: row.status, cityId: row.city_id, cityName: row.city_name,
    vehicle: row.vehicle, plate: row.plate, available: row.available, blockedReason: row.blocked_reason,
  };
}

/** Quem entrou é um entregador da rede. Devolve o perfil e o cadastro dele. */
export async function requireCourier(): Promise<{ profile: CurrentProfile; courier: Courier }> {
  const profile = await requireRole("courier");
  const courier = await getCourier(profile.id);
  if (!courier) redirect("/quero-entregar");
  return { profile, courier };
}

export type DeliveryOffer = {
  id: string;
  code: string;
  status: OrderStatus;
  storeName: string;
  storeAddress: string;
  destination: string;
  feeCents: number;
  /** Quem paga o entregador: a loja (pedido pago direto a ela) ou o Chegô (pedido pago pelo app). */
  paidBy: "store" | "platform";
  requiresAgeCheck: boolean;
  estimatedAt: Date | null;
};

/**
 * Entregas da rede que ainda não têm entregador, na cidade informada.
 * Só mostra de onde sai, para que bairro vai e quanto paga: o nome, o telefone e o
 * endereço do cliente só aparecem para o entregador que pegar a entrega.
 */
export async function listOffers(cityId: string): Promise<DeliveryOffer[]> {
  const rows = await sql<{
    id: string; code: string; status: OrderStatus; store_name: string; street: string; number: string; store_hood: string | null;
    destination: string | null; courier_fee_cents: number; requires_age_check: boolean; estimated_at: Date | null; payment_collection: "app" | "store";
  }[]>`
    select o.id, o.code, o.status, s.name as store_name, s.street, s.number, sn.name as store_hood,
           o.address_snapshot->>'neighborhood' as destination, o.courier_fee_cents, o.requires_age_check, o.estimated_at, o.payment_collection
    from orders o
    join stores s on s.id = o.store_id
    left join neighborhoods sn on sn.id = s.neighborhood_id
    where o.delivery_provider = 'platform' and o.fulfillment = 'delivery' and o.courier_id is null
      and o.status::text = any(${OFFER_STATUSES}) and o.city_id = ${cityId}
    order by o.accepted_at nulls last, o.created_at
    limit 30`;
  return rows.map((row) => ({
    id: row.id, code: row.code, status: row.status, storeName: row.store_name,
    storeAddress: [`${row.street}, ${row.number}`, row.store_hood].filter(Boolean).join(" · "),
    destination: row.destination ?? "Endereço do cliente", feeCents: row.courier_fee_cents, paidBy: row.payment_collection === "store" ? "store" : "platform",
    requiresAgeCheck: row.requires_age_check, estimatedAt: row.estimated_at,
  }));
}

/** Onde retirar cada pedido: o endereço das lojas, pelo id do pedido. */
export async function pickupPlaces(orderIds: string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const rows = await sql<{ id: string; street: string; number: string; hood: string | null }[]>`
    select o.id, s.street, s.number, n.name as hood
    from orders o join stores s on s.id = o.store_id left join neighborhoods n on n.id = s.neighborhood_id
    where o.id = any(${orderIds}::uuid[])`;
  return new Map(rows.map((row) => [row.id, [`${row.street}, ${row.number}`, row.hood].filter(Boolean).join(" · ")]));
}
