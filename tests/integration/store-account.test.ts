import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE, TEST_STORAGE } from "../reset-test-db";
import { sql } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { AccountError, closeStore, liftSuspension, runSuspensionSchedule, setStoreActive, suspendStore } from "@/lib/admin/store-account";
import { getStoreMemberships } from "@/lib/auth/session";
import { sql as appSql } from "@/lib/db";

// Suspensão, reativação e exclusão lógica de lojas, pelo mesmo código do painel.

const AT = new Date("2026-10-21T10:00:00-03:00");
const HOUR = 3_600_000;
const storeBySlug = async (slug: string) => (await sql<{ id: string; owner_id: string }[]>`select id, owner_id from stores where slug = ${slug}`)[0];
const statusOf = async (id: string) => (await sql<{ status: string }[]>`select status::text from stores where id = ${id}`)[0].status;

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
});

describe("conta da loja", () => {
  it("suspende na hora, não aceita duas suspensões, reativa voltando à situação anterior", async () => {
    const store = await storeBySlug("acai-tropical");
    const [admin] = await sql<{ id: string }[]>`select id from profiles where role = 'admin' and is_super_admin limit 1`;
    const before = await statusOf(store.id);

    await appSql.begin((tx) => suspendStore(tx, { storeId: store.id, reason: "Teste de suspensão", description: null, startsAt: AT, endsAt: null, notifyOwner: true, actorId: admin.id, at: AT }));
    expect(await statusOf(store.id)).toBe("suspended");
    await expect(appSql.begin((tx) => suspendStore(tx, { storeId: store.id, reason: "De novo", description: null, startsAt: AT, endsAt: null, notifyOwner: false, actorId: admin.id, at: AT }))).rejects.toThrow(AccountError);
    // Suspensa, não se ativa por "ativar": tem que reativar.
    await expect(appSql.begin((tx) => setStoreActive(tx, { storeId: store.id, active: true, reason: "", actorId: admin.id, at: AT }))).rejects.toThrow(/Reativar/);
    expect((await sql`select count(*)::int as n from notifications where type = 'store_suspended' and profile_id = ${store.owner_id}`)[0].n).toBe(1);

    await appSql.begin((tx) => liftSuspension(tx, { storeId: store.id, reason: "Resolvido", actorId: admin.id, at: new Date(AT.getTime() + HOUR) }));
    expect(await statusOf(store.id)).toBe(before);
    const kinds = (await sql`select kind from store_status_events where store_id = ${store.id} order by created_at`).map((row) => row.kind);
    expect(kinds.slice(-2)).toEqual(["suspensa", "reativada"]);
    const actions = (await sql`select action from audit_logs where entity_id = ${store.id} and module = 'lojas' order by created_at`).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["loja.suspensa", "loja.reativada"]));
  });

  it("suspensão agendada entra no início e sai sozinha no fim do prazo", async () => {
    const store = await storeBySlug("brasa-burger");
    const [admin] = await sql<{ id: string }[]>`select id from profiles where role = 'admin' and is_super_admin limit 1`;
    const startsAt = new Date(AT.getTime() + 2 * HOUR);
    const endsAt = new Date(AT.getTime() + 5 * HOUR);
    const { applied } = await appSql.begin((tx) => suspendStore(tx, { storeId: store.id, reason: "Agendada", description: "Detalhe", startsAt, endsAt, notifyOwner: false, actorId: admin.id, at: AT }));
    expect(applied).toBe(false);
    expect(await statusOf(store.id)).toBe("active");

    expect(await runSuspensionSchedule(new Date(AT.getTime() + HOUR))).toEqual({ applied: 0, lifted: 0 });
    expect(await runSuspensionSchedule(new Date(AT.getTime() + 3 * HOUR))).toEqual({ applied: 1, lifted: 0 });
    expect(await statusOf(store.id)).toBe("suspended");
    // Rodar de novo não faz nada (tarefa idempotente).
    expect(await runSuspensionSchedule(new Date(AT.getTime() + 3 * HOUR))).toEqual({ applied: 0, lifted: 0 });
    expect(await runSuspensionSchedule(new Date(AT.getTime() + 6 * HOUR))).toEqual({ applied: 0, lifted: 1 });
    expect(await statusOf(store.id)).toBe("active");
  });

  it("exclusão: recusada com pedido em andamento; depois a loja sai do ar e do painel, e os pedidos ficam", async () => {
    const [busy] = await sql<{ store_id: string }[]>`select store_id from orders where status = 'preparing' limit 1`;
    const [admin] = await sql<{ id: string }[]>`select id from profiles where role = 'admin' and is_super_admin limit 1`;
    await expect(appSql.begin((tx) => closeStore(tx, { storeId: busy.store_id, by: "admin", reason: "Teste", actorId: admin.id, at: AT }))).rejects.toThrow(/em andamento/);

    const [store] = await sql<{ id: string; owner_id: string }[]>`
      select s.id, s.owner_id from stores s where s.status = 'active'
        and not exists (select 1 from orders o where o.store_id = s.id and o.status in ('awaiting_payment', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery'))
        and exists (select 1 from orders o where o.store_id = s.id)
      limit 1`;
    const orders = (await sql`select count(*)::int as n from orders where store_id = ${store.id}`)[0].n;
    await sql`insert into ad_campaigns (store_id, title, placement, starts_at, ends_at) values (${store.id}, 'Campanha', 'inicio', ${AT}, ${new Date(AT.getTime() + 48 * HOUR)})`;

    await appSql.begin((tx) => closeStore(tx, { storeId: store.id, by: "empresa", reason: "Fechamos a loja física", actorId: store.owner_id, at: AT }));
    const [after] = await sql`select status::text, closed_by_kind, closed_reason from stores where id = ${store.id}`;
    expect(after).toEqual({ status: "suspended", closed_by_kind: "empresa", closed_reason: "Fechamos a loja física" });
    expect((await sql`select count(*)::int as n from orders where store_id = ${store.id}`)[0].n).toBe(orders);
    expect((await sql`select status::text from ad_campaigns where store_id = ${store.id}`).map((row) => row.status)).toEqual(["encerrada"]);
    expect((await getStoreMemberships(store.owner_id)).some((item) => item.storeId === store.id)).toBe(false);
    // Excluída não volta por nenhuma ação.
    await expect(appSql.begin((tx) => liftSuspension(tx, { storeId: store.id, reason: "Volta", actorId: admin.id, at: AT }))).rejects.toThrow(/excluída/);
  });
});
