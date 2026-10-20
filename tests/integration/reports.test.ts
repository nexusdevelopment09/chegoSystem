import { afterAll, describe, expect, it } from "vitest";
import { sql } from "./helpers";
import { sql as appSql } from "@/lib/db";
import { loadReportOrders, parseReportFilters } from "@/lib/merchant/report-data";
import { SEGMENTS, segmentRows, summarize, type Segment } from "@/lib/merchant/report-rules";

// Relatórios contra os pedidos do seed: o indicador e a listagem saem das mesmas linhas,
// os filtros fazem o que dizem e uma loja nunca vê pedido de outra.

afterAll(() => Promise.all([sql.end(), appSql.end()]));

const AT = new Date("2026-10-09T15:00:00-03:00");
const storeId = async (slug: string) => (await sql<{ id: string }[]>`select id from stores where slug = ${slug}`)[0].id;

describe("relatórios da loja (banco de teste)", () => {
  it("cada indicador é igual à soma e à contagem da sua listagem, e bate com o banco", async () => {
    const pizzaria = await storeId("pizzaria-forno-de-barro");
    const filters = parseReportFilters({ de: "2026-07-01", ate: "2026-10-09" }, "2026-10-09");
    const orders = await loadReportOrders(pizzaria, filters);
    expect(orders.length).toBeGreaterThan(20);
    const summary = summarize(orders, AT);
    expect(summary.sold.count).toBe(segmentRows(orders, "vendidos", AT).count);

    // Conferência independente, direto no banco, com a regra de "vendido" de sempre.
    const [db] = await sql<{ count: number; total: number; fees: number }[]>`
      select count(*)::int as count, coalesce(sum(total_cents - refunded_cents), 0)::int as total,
             coalesce(sum(delivery_fee_cents) filter (where delivery_fee_cents > 0), 0)::int as fees
      from orders where store_id = ${pizzaria} and paid_at is not null
        and status not in ('rejected', 'cancelled', 'refunded', 'expired')
        and paid_at >= '2026-07-01T00:00:00-03:00' and paid_at < '2026-10-10T00:00:00-03:00'`;
    expect(summary.sold).toEqual({ count: db.count, totalCents: db.total });
    expect(summary.deliveryFees.totalCents).toBe(db.fees);

    for (const segment of Object.keys(SEGMENTS) as Segment[]) {
      const { rows, totalCents } = segmentRows(orders, segment, AT);
      const amount = SEGMENTS[segment].amount;
      if (amount) expect(rows.reduce((sum, row) => sum + amount(row, AT), 0), segment).toBe(totalCents);
    }
  });

  it("os filtros fazem o que dizem e respeitam o horário de Maceió", async () => {
    const pizzaria = await storeId("pizzaria-forno-de-barro");
    const base = { de: "2026-07-01", ate: "2026-10-09" };
    const all = await loadReportOrders(pizzaria, parseReportFilters(base, "2026-10-09"));
    const pickup = await loadReportOrders(pizzaria, parseReportFilters({ ...base, modalidade: "pickup" }, "2026-10-09"));
    expect(pickup.every((order) => order.fulfillment === "pickup")).toBe(true);
    expect(pickup.length).toBe(all.filter((order) => order.fulfillment === "pickup").length);
    const pix = await loadReportOrders(pizzaria, parseReportFilters({ ...base, pagamento: "pix" }, "2026-10-09"));
    expect(pix.every((order) => order.paymentMethod === "pix")).toBe(true);
    const cancelled = await loadReportOrders(pizzaria, parseReportFilters({ ...base, status: "cancelados" }, "2026-10-09"));
    expect(cancelled.every((order) => order.status === "rejected" || order.status === "cancelled")).toBe(true);

    // Um dia = meia-noite a meia-noite em Maceió.
    const day = all[0].paidAt;
    const local = new Date(day.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
    const sameDay = await loadReportOrders(pizzaria, parseReportFilters({ de: local, ate: local }, "2026-10-09"));
    expect(sameDay.map((order) => order.id)).toContain(all[0].id);
    for (const order of sameDay) expect(new Date(order.paidAt.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)).toBe(local);

    // Pedido pelo número.
    const byCode = await loadReportOrders(pizzaria, parseReportFilters({ ...base, pedido: all[0].code }, "2026-10-09"));
    expect(byCode.map((order) => order.id)).toEqual([all[0].id]);
  });

  it("uma loja nunca vê pedido de outra, nem pelo número", async () => {
    const pizzaria = await storeId("pizzaria-forno-de-barro");
    const burger = await storeId("brasa-burger");
    const [foreign] = await sql<{ code: string }[]>`select code from orders where store_id = ${burger} and paid_at is not null limit 1`;
    const found = await loadReportOrders(pizzaria, parseReportFilters({ de: "2026-01-01", ate: "2026-10-09", pedido: foreign.code }, "2026-10-09"));
    expect(found).toEqual([]);
    const mine = await loadReportOrders(pizzaria, parseReportFilters({ de: "2026-01-01", ate: "2026-10-09" }, "2026-10-09"));
    const ids = mine.map((order) => order.id);
    const [{ others }] = await sql<{ others: number }[]>`select count(*)::int as others from orders where id = any(${ids}::uuid[]) and store_id <> ${pizzaria}`;
    expect(others).toBe(0);
  });

  it("atalhos de período", () => {
    expect(parseReportFilters({}, "2026-10-09")).toMatchObject({ preset: "30", from: "2026-09-10", to: "2026-10-09" });
    expect(parseReportFilters({ periodo: "hoje" }, "2026-10-09")).toMatchObject({ from: "2026-10-09", to: "2026-10-09" });
    expect(parseReportFilters({ periodo: "ontem" }, "2026-10-09")).toMatchObject({ from: "2026-10-08", to: "2026-10-08" });
    expect(parseReportFilters({ periodo: "7" }, "2026-10-09")).toMatchObject({ from: "2026-10-03", to: "2026-10-09" });
    expect(parseReportFilters({ periodo: "mes" }, "2026-10-09")).toMatchObject({ from: "2026-10-01", to: "2026-10-09" });
    expect(parseReportFilters({ dias: "90" }, "2026-10-09")).toMatchObject({ from: "2026-07-12", to: "2026-10-09" });
    // Lixo na URL não quebra nada.
    expect(parseReportFilters({ bairro: "'; drop table orders;--", hora: "99", status: "x" }, "2026-10-09")).toMatchObject({ bairro: undefined, hora: undefined, status: undefined });
  });
});
