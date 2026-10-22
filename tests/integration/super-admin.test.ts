import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { sql } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { attributedCampaign, liveCampaigns } from "@/lib/ads/campaigns";
import { resolveRange } from "@/lib/admin/range";
import { overview, salesByStore } from "@/lib/admin/super";
import type { CurrentProfile } from "@/lib/auth/session";
import { placeOrder } from "@/lib/checkout/place-order";
import { sql as appSql } from "@/lib/db";
import { recalculateRating } from "@/lib/stores/rating";

// Números do super admin e anúncios, pelo mesmo código do painel, no banco de teste.

const AT = new Date("2026-10-09T15:00:00-03:00");
const HOUR = 3_600_000;
let market: { id: string; city_id: string; min_order_cents: number };

beforeAll(async () => {
  [market] = await sql`select id, city_id, min_order_cents from stores where slug = 'mercado-boa-compra'`;
});

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("super admin", () => {
  it("indicadores do painel saem dos registros: pedidos, vendas, lojas e a comparação com o período anterior", async () => {
    const range = resolveRange({ periodo: "mes" }, AT);
    const data = await overview(range, null, AT);
    const [expected] = await sql`
      select (select count(*)::int from orders where created_at >= ${range.from} and created_at < ${range.to}) as orders,
             (select count(*)::int from orders where created_at >= ${range.previous.from} and created_at < ${range.previous.to}) as previous,
             (select coalesce(sum(total_cents - refunded_cents), 0)::int from orders where paid_at >= ${range.from} and paid_at < ${range.to}
                and status not in ('rejected', 'cancelled', 'refunded', 'expired')) as sales,
             (select count(*)::int from stores where closed_at is null and status = 'active') as active,
             (select count(*)::int from stores where status = 'pending') as pending`;
    expect(data.orders.total).toEqual({ current: expected.orders, previous: expected.previous });
    expect(data.sales.gmvCents.current).toBe(expected.sales);
    expect(data.stores.active).toBe(expected.active);
    expect(data.stores.pending).toBe(expected.pending);
    // O gráfico soma o mesmo que o indicador.
    expect(data.ordersSeries.reduce((sum, point) => sum + point.value, 0)).toBe(expected.orders);
    expect(data.salesSeries.reduce((sum, point) => sum + point.value, 0)).toBe(expected.sales);

    // A soma das lojas bate com o total da plataforma.
    const stores = await salesByStore(range, null);
    expect(stores.reduce((sum, row) => sum + row.sales_cents, 0)).toBe(expected.sales);
  });

  it("campanhas no ar: só ativas, no horário, de loja ativa; maior prioridade primeiro", async () => {
    const [a, b] = await sql<{ id: string }[]>`select id from stores where city_id = ${market.city_id} and status = 'active' and closed_at is null order by name limit 2`;
    const ins = (store: string, title: string, extra: Record<string, unknown> = {}) => sql`
      insert into ad_campaigns ${sql({ store_id: store, title, placement: "inicio", priority: 50, starts_at: new Date(AT.getTime() - HOUR), ends_at: new Date(AT.getTime() + HOUR), ...extra })}`;
    await ins(a.id, "Prioridade baixa", { priority: 10 });
    await ins(b.id, "Prioridade alta", { priority: 90 });
    await ins(a.id, "Pausada", { status: "pausada", priority: 100 });
    await ins(b.id, "Vencida", { ends_at: new Date(AT.getTime() - 1000), starts_at: new Date(AT.getTime() - 2 * HOUR), priority: 100 });
    await ins(a.id, "Futura", { starts_at: new Date(AT.getTime() + HOUR), ends_at: new Date(AT.getTime() + 2 * HOUR), priority: 100 });

    const live = await liveCampaigns({ cityId: market.city_id, at: AT, placements: ["inicio"] });
    expect(live.map((item) => item.title)).toEqual(["Prioridade alta", "Prioridade baixa"]);
  });

  it("pedido feito até 24 h depois do clique é atribuído à campanha da mesma loja; a nota da loja não muda", async () => {
    const [campaign] = await sql<{ id: string }[]>`
      insert into ad_campaigns (store_id, title, placement, starts_at, ends_at) values (${market.id}, 'Atribuição', 'topo', ${new Date(AT.getTime() - HOUR)}, ${new Date(AT.getTime() + HOUR)}) returning id`;
    const cookie = `${campaign.id}.${AT.getTime() - HOUR}`;
    expect(await attributedCampaign(cookie, market.id, AT)).toBe(campaign.id);
    expect(await attributedCampaign(cookie, "00000000-0000-0000-0000-000000000000", AT)).toBeNull();
    expect(await attributedCampaign(`${campaign.id}.${AT.getTime() - 25 * HOUR}`, market.id, AT)).toBeNull();
    expect(await attributedCampaign("lixo", market.id, AT)).toBeNull();

    const [profile] = await sql`select id, full_name, phone, birth_date::text, city_id from profiles where full_name = 'Diego Alves'`;
    const customer: CurrentProfile = { id: profile.id, fullName: profile.full_name, phone: profile.phone, role: "customer", blocked: false, birthDate: profile.birth_date, cityId: profile.city_id };
    const [{ id: addressId }] = await sql`select id from addresses where profile_id = ${profile.id} and deleted_at is null limit 1`;
    const [product] = await sql`
      select p.id, p.price_cents from products p where p.store_id = ${market.id} and p.available and p.deleted_at is null and not p.requires_age_check
        and not exists (select 1 from product_option_groups g where g.product_id = p.id) and not exists (select 1 from product_availability a where a.product_id = p.id)
        and p.max_per_order is null and p.weight_step_grams is null and (not p.track_stock or p.stock_qty > 50)
      order by p.price_cents desc limit 1`;
    const [before] = await sql`select rating_avg from stores where id = ${market.id}`;
    const placed = await placeOrder({
      storeId: market.id, fulfillment: "delivery", addressId, ageConfirmed: false, missingItemPolicy: "remove", notes: "", paymentMethod: "pix", couponCode: null,
      items: [{ key: "i", productId: product.id, quantity: Math.max(1, Math.ceil(market.min_order_cents / product.price_cents)), notes: "", picks: [] }],
    }, customer, AT, undefined, cookie);
    if (!placed.ok) throw new Error(placed.errors.join(" | "));
    expect((await sql`select ad_campaign_id from orders where id = ${placed.orderId}`)[0].ad_campaign_id).toBe(campaign.id);
    await recalculateRating(sql, market.id, AT);
    expect((await sql`select rating_avg from stores where id = ${market.id}`)[0].rating_avg).toBe(before.rating_avg);
  });
});
