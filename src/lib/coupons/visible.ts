import "server-only";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";

// Cupons que o cliente pode usar agora, para mostrar no início e em /ofertas. As mesmas
// regras de validate.ts que dependem só do cliente e da data; as que dependem do
// carrinho (pedido mínimo, frete) viram condições escritas no banner.

export type VisibleCoupon = {
  id: string;
  code: string;
  /** "10% de desconto", "R$ 10,00 de desconto", "Frete grátis". */
  benefit: string;
  description: string;
  conditions: string[];
  /** Para onde "Ver ofertas" leva: a loja do cupom, o segmento ou a página de ofertas. */
  href: string;
  storeName: string | null;
};

type Row = {
  id: string; code: string; description: string; type: "fixed" | "percent" | "free_delivery";
  value_cents: number | null; percent: string | null; max_discount_cents: number | null;
  min_order_cents: number; first_order_only: boolean; expires_at: Date | null; paid_by: "platform" | "store";
  store_slugs: string[]; store_names: string[]; category_slugs: string[]; category_names: string[];
};

const dayMonth = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Maceio" }).format(date);

export function couponBenefit(row: Pick<Row, "type" | "value_cents" | "percent" | "max_discount_cents">): string {
  if (row.type === "free_delivery") return "Frete grátis";
  if (row.type === "percent") {
    const percent = `${Number(row.percent).toLocaleString("pt-BR")}% de desconto`;
    return row.max_discount_cents ? `${percent} (até ${formatCents(row.max_discount_cents)})` : percent;
  }
  return `${formatCents(row.value_cents ?? 0)} de desconto`;
}

export async function visibleCoupons(input: { cityId: string; profileId: string | null; at: Date; limit?: number }): Promise<VisibleCoupon[]> {
  const [paid] = input.profileId
    ? await sql<{ count: number }[]>`select count(*)::int as count from orders where customer_id = ${input.profileId} and paid_at is not null`
    : [{ count: 0 }];

  const rows = await sql<Row[]>`
    select c.id, c.code, c.description, c.type, c.value_cents, c.percent::text, c.max_discount_cents,
           c.min_order_cents, c.first_order_only, c.expires_at, c.paid_by,
           coalesce(array(select s.slug from stores s where s.id = any(c.store_ids) and s.status = 'active' and s.city_id = ${input.cityId} order by s.name), '{}') as store_slugs,
           coalesce(array(select s.name from stores s where s.id = any(c.store_ids) and s.status = 'active' and s.city_id = ${input.cityId} order by s.name), '{}') as store_names,
           coalesce(array(select k.slug from categories k where k.id = any(c.category_ids) and k.active order by k.sort_order), '{}') as category_slugs,
           coalesce(array(select k.name from categories k where k.id = any(c.category_ids) and k.active order by k.sort_order), '{}') as category_names
    from coupons c
    where c.active
      and (c.starts_at is null or c.starts_at <= ${input.at})
      and (c.expires_at is null or c.expires_at > ${input.at})
      and (c.max_uses is null or c.uses_count < c.max_uses)
      and (cardinality(c.city_ids) = 0 or ${input.cityId}::uuid = any(c.city_ids))
      and (c.owner_profile_id is null or c.owner_profile_id = ${input.profileId})
      ${paid.count > 0 ? sql`and not c.first_order_only` : sql``}
      ${input.profileId
        ? sql`and (select count(*) from coupon_redemptions r where r.coupon_id = c.id and r.customer_id = ${input.profileId}) < c.max_uses_per_customer`
        : sql``}
    order by c.first_order_only desc, (c.paid_by = 'platform') desc, c.created_at desc`;

  return rows
    // Cupom de loja só aparece se a loja estiver no ar (e na cidade do cliente).
    .filter((row) => row.paid_by === "platform" || row.store_slugs.length > 0)
    .slice(0, input.limit ?? 5)
    .map((row) => {
      const conditions: string[] = [];
      if (row.first_order_only) conditions.push("Na primeira compra");
      if (row.min_order_cents > 0) conditions.push(`Pedido mínimo de ${formatCents(row.min_order_cents)}`);
      if (row.store_names.length > 0) conditions.push(`Só na ${row.store_names.join(", ")}`);
      else if (row.category_names.length > 0) conditions.push(`Em ${row.category_names.join(", ")}`);
      if (row.expires_at) conditions.push(`Válido até ${dayMonth(row.expires_at)}`);
      return {
        id: row.id, code: row.code, benefit: couponBenefit(row), description: row.description, conditions,
        href: row.store_slugs.length === 1 ? `/loja/${row.store_slugs[0]}` : row.category_slugs.length === 1 ? `/categoria/${row.category_slugs[0]}` : "/ofertas",
        storeName: row.store_names[0] ?? null,
      };
    });
}
