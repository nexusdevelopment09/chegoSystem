import { z } from "zod";
import { sql } from "@/lib/db";
import { getShoppingContext } from "@/lib/shopping-context";
import { likePattern } from "@/lib/stores/queries";

// Names of stores and products that match what the customer is typing.
export async function GET(request: Request) {
  const parsed = z.string().trim().min(2).max(60).safeParse(new URL(request.url).searchParams.get("q"));
  const { city } = await getShoppingContext();
  if (!parsed.success || !city) return Response.json({ suggestions: [] });

  const pattern = likePattern(parsed.data);
  const rows = await sql<{ name: string }[]>`
    select name from (
      select s.name, 0 as kind, similarity(s.name, ${parsed.data}) as score
      from stores s
      where s.city_id = ${city.id} and s.status in ('active', 'paused')
        and unaccent(s.name) ilike unaccent(${pattern})
      union
      select p.name, 1 as kind, similarity(p.name, ${parsed.data}) as score
      from products p join stores s on s.id = p.store_id
      where s.city_id = ${city.id} and s.status in ('active', 'paused') and p.deleted_at is null
        and unaccent(p.name) ilike unaccent(${pattern})
    ) matches
    group by name
    order by min(kind), max(score) desc, name
    limit 6`;

  return Response.json({ suggestions: rows.map((row) => row.name) });
}
