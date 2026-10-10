"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { CITY_COOKIE, HOOD_COOKIE } from "@/lib/shopping-context";

const YEAR = 60 * 60 * 24 * 365;

/** Lembra a cidade e o bairro de onde o cliente está comprando. */
export async function chooseLocation(formData: FormData) {
  const parsed = z
    .object({ cityId: z.uuid(), neighborhoodId: z.union([z.uuid(), z.literal("")]) })
    .safeParse({ cityId: formData.get("cityId"), neighborhoodId: formData.get("neighborhoodId") ?? "" });
  if (!parsed.success) redirect("/boas-vindas");

  const [city] = await sql`select id from cities where id = ${parsed.data.cityId} and active`;
  if (!city) redirect("/boas-vindas");

  const cookieStore = await cookies();
  const options = { path: "/", maxAge: YEAR, sameSite: "lax" as const };
  cookieStore.set(CITY_COOKIE, parsed.data.cityId, options);

  const [hood] = parsed.data.neighborhoodId
    ? await sql`select id from neighborhoods where id = ${parsed.data.neighborhoodId} and city_id = ${parsed.data.cityId}`
    : [];
  if (hood) cookieStore.set(HOOD_COOKIE, parsed.data.neighborhoodId, options);
  else cookieStore.delete(HOOD_COOKIE);

  redirect("/");
}
