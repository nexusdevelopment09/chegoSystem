import "server-only";
import { cache } from "react";
import { requirePermission, requireStoreMember, type CurrentProfile, type StoreMembership, type StoreRole } from "@/lib/auth/session";
import type { Permission } from "./permissions";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { storeAvailability, type Shift, type StoreAvailability } from "@/lib/stores/hours";

export type MerchantStore = {
  id: string;
  name: string;
  slug: string;
  status: "pending" | "active" | "paused" | "suspended";
  manualState: "auto" | "open" | "closed";
  pausedUntil: Date | null;
  busyExtraMinutes: number;
  prepMinutes: number;
  autoPrint: boolean;
  printerWidth: number;
  categorySlug: string;
  availability: StoreAvailability;
};

export type MerchantContext = { profile: CurrentProfile; membership: StoreMembership; store: MerchantStore; at: Date };

const loadStore = cache(async (storeId: string, atMs: number): Promise<MerchantStore> => {
  const at = new Date(atMs);
  const [row] = await sql<{
    id: string; name: string; slug: string; status: MerchantStore["status"]; manual_state: MerchantStore["manualState"];
    paused_until: Date | null; busy_extra_minutes: number; prep_time_minutes: number; auto_print: boolean;
    printer_width_mm: number; category_slug: string; shifts: Shift[]; closures: { startsAt: string; endsAt: string }[];
  }[]>`
    select s.id, s.name, s.slug, s.status, s.manual_state, s.paused_until, s.busy_extra_minutes, s.prep_time_minutes,
           s.auto_print, s.printer_width_mm, c.slug as category_slug,
           coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text,
             'closesAt', h.closes_at::text, 'pickupOnly', h.pickup_only)) from store_hours h where h.store_id = s.id), '[]') as shifts,
           coalesce((select json_agg(json_build_object('startsAt', cl.starts_at, 'endsAt', cl.ends_at))
             from store_closures cl where cl.store_id = s.id and cl.ends_at > ${at}), '[]') as closures
    from stores s join categories c on c.id = s.category_id
    where s.id = ${storeId}`;

  return {
    id: row.id, name: row.name, slug: row.slug, status: row.status, manualState: row.manual_state,
    pausedUntil: row.paused_until, busyExtraMinutes: row.busy_extra_minutes, prepMinutes: row.prep_time_minutes,
    autoPrint: row.auto_print, printerWidth: row.printer_width_mm, categorySlug: row.category_slug,
    availability: storeAvailability({
      status: row.status, manualState: row.manual_state, pausedUntil: row.paused_until, shifts: row.shifts,
      closures: row.closures.map((closure) => ({ startsAt: new Date(closure.startsAt), endsAt: new Date(closure.endsAt) })),
    }, at),
  };
});

/**
 * O usuário de loja que entrou, a loja em que trabalha e a hora atual. Recebe os papéis
 * aceitos ou uma permissão (o dono tem todas; os outros, as que o dono deu).
 */
export async function getMerchantContext(access: StoreRole[] | Permission): Promise<MerchantContext> {
  const { profile, membership } = Array.isArray(access) ? await requireStoreMember(access) : await requirePermission(access);
  const at = await now();
  return { profile, membership, store: await loadStore(membership.storeId, at.getTime()), at };
}

export type TeamMember = { id: string; name: string; phone: string | null; role: StoreRole };

/** Todo mundo que trabalha na loja. Chame só depois de conferir que quem está vendo pertence a ela. */
export async function getTeam(storeId: string): Promise<TeamMember[]> {
  const rows = await sql<{ id: string; full_name: string; phone: string | null; role: StoreRole }[]>`
    select p.id, p.full_name, p.phone, m.role
    from store_members m join profiles p on p.id = m.profile_id
    where m.store_id = ${storeId} and m.active
    order by m.role, p.full_name`;
  return rows.map((row) => ({ id: row.id, name: row.full_name, phone: row.phone, role: row.role }));
}
