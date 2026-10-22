import "server-only";
import { isSuperAdmin, requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { addDays } from "@/lib/fees/rules";
import { toLocal } from "@/lib/time";
import { resolveRange } from "./range";

/** O que toda tela do super admin precisa: quem é, o período, a cidade e o relógio do app. */
export async function adminContext(params: Record<string, string | undefined>) {
  const profile = await requireRole("admin");
  const [superAdmin, at, cities] = await Promise.all([
    isSuperAdmin(profile.id), now(), sql<{ id: string; name: string }[]>`select id, name from cities order by name`,
  ]);
  const cityId = cities.find((city) => city.id === params.cidade)?.id ?? null;
  return { profile, superAdmin, at, cities, cityId, range: resolveRange(legacyRange(params, at), at) };
}

/** Links antigos do admin: `periodo=7|30|90` (últimos N dias) e `dia=AAAA-MM-DD` viram de/até. */
function legacyRange(params: Record<string, string | undefined>, at: Date) {
  const today = toLocal(at).date;
  if (params.dia && /^\d{4}-\d{2}-\d{2}$/.test(params.dia)) return { de: params.dia, ate: params.dia };
  if (params.periodo && ["7", "30", "90"].includes(params.periodo)) return { de: addDays(today, -(Number(params.periodo) - 1)), ate: today };
  return params;
}

/** Número da página da lista (1, 2, 3...). */
export const pageNumber = (value: string | undefined) => Math.max(1, Math.min(10_000, Number(value) || 1));
