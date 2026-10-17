import { withUser } from "@/lib/db";
import { getMerchantContext } from "@/lib/merchant/context";
import { toMenuCsv, type CsvProduct } from "@/lib/merchant/csv";

// O cardápio da loja em planilha (CSV), para editar no Excel e enviar de volta.
export async function GET() {
  const { profile, store } = await getMerchantContext(["owner", "attendant"]);

  const rows = await withUser(profile.id, (tx) => tx<{
    section: string | null; name: string; description: string; price_cents: number; available: boolean;
    track_stock: boolean; stock_qty: number | null; weight_step_grams: number | null; price_per_kg_cents: number | null;
  }[]>`
    select s.name as section, p.name, p.description, p.price_cents, p.available, p.track_stock, p.stock_qty,
           p.weight_step_grams, p.price_per_kg_cents
    from products p left join product_sections s on s.id = p.section_id
    where p.store_id = ${store.id} and p.deleted_at is null
    order by s.sort_order nulls last, p.sort_order, p.name`);

  // Produto vendido por peso: o preço que vai na planilha é o do quilo, e o estoque, em gramas.
  const products: CsvProduct[] = rows.map((row) => ({
    section: row.section ?? "", name: row.name, description: row.description, priceCents: row.price_per_kg_cents ?? row.price_cents,
    available: row.available, stock: row.track_stock ? (row.stock_qty ?? 0) * (row.weight_step_grams ?? 1) : null,
  }));

  return new Response(toMenuCsv(products), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cardapio-${store.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
