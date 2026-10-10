import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/session";
import { sql } from "@/lib/db";

// Onde o cliente está comprando: a cidade e, quando se sabe, o bairro
// (que decide a taxa e o tempo de entrega). Fica em cookies para funcionar também
// antes de entrar.

export const CITY_COOKIE = "chego_city";
export const HOOD_COOKIE = "chego_hood";

export type ShoppingContext = {
  city: { id: string; name: string; state: string; maintenance: boolean } | null;
  neighborhood: { id: string; name: string; isRural: boolean } | null;
  /** Verdadeiro quando o visitante nunca escolheu uma cidade e não tem endereço salvo (primeira visita). */
  firstVisit: boolean;
};

const UUID = /^[0-9a-f-]{36}$/i;

export const getShoppingContext = cache(async (): Promise<ShoppingContext> => {
  const cookieStore = await cookies();
  const cityCookie = cookieStore.get(CITY_COOKIE)?.value;
  const hoodCookie = cookieStore.get(HOOD_COOKIE)?.value;

  let fromAddress = false;
  let hoodId = hoodCookie && UUID.test(hoodCookie) ? hoodCookie : null;
  let cityId = cityCookie && UUID.test(cityCookie) ? cityCookie : null;

  // Para clientes que entraram, o padrão é o endereço principal.
  if (!hoodId) {
    const profile = await getCurrentProfile();
    if (profile) {
      const [address] = await sql<{ neighborhood_id: string; city_id: string }[]>`
        select a.neighborhood_id, n.city_id
        from addresses a join neighborhoods n on n.id = a.neighborhood_id
        where a.profile_id = ${profile.id} and a.deleted_at is null
        order by a.is_default desc, a.created_at desc
        limit 1`;
      if (address) {
        hoodId = address.neighborhood_id;
        fromAddress = true;
        cityId ??= address.city_id;
      }
    }
  }

  const [city] = cityId
    ? await sql<{ id: string; name: string; state: string; maintenance: boolean }[]>`
        select id, name, state, maintenance_mode as maintenance from cities where id = ${cityId} and active`
    : [];

  const [hood] = city && hoodId
    ? await sql<{ id: string; name: string; is_rural: boolean }[]>`
        select id, name, is_rural from neighborhoods where id = ${hoodId} and city_id = ${city.id} and active`
    : [];

  return {
    city: city ?? null,
    neighborhood: hood ? { id: hood.id, name: hood.name, isRural: hood.is_rural } : null,
    firstVisit: !cityCookie && !fromAddress,
  };
});

export type CityOption = { id: string; name: string; state: string; neighborhoods: { id: string; name: string; isRural: boolean }[] };

/** Cidades ativas com seus bairros e comunidades rurais. */
export async function listCities(): Promise<CityOption[]> {
  const rows = await sql<{ id: string; name: string; state: string; hoods: { id: string; name: string; isRural: boolean }[] }[]>`
    select c.id, c.name, c.state,
      coalesce((
        select json_agg(json_build_object('id', n.id, 'name', n.name, 'isRural', n.is_rural) order by n.is_rural, n.name)
        from neighborhoods n where n.city_id = c.id and n.active
      ), '[]') as hoods
    from cities c
    where c.active
    order by c.name`;
  return rows.map((row) => ({ id: row.id, name: row.name, state: row.state, neighborhoods: row.hoods }));
}
