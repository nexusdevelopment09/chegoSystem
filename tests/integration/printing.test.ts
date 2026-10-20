import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asUser, inRolledBackTransaction, sql } from "./helpers";

// `now()` pede ao Next uma requisição em andamento; aqui não há Next rodando.
vi.mock("next/server", () => ({ connection: async () => {} }));

import { sql as appSql } from "@/lib/db";
import { claimJobs, ensureAutoJobs, finishJob, requestJob } from "@/lib/printing/jobs";

// Fila de impressão contra o banco de teste: um trabalho por impressora e pedido, pego uma
// vez só (mesmo com duas abas ao mesmo tempo), e nada de uma loja passa para outra.

const device = randomUUID();
const otherDevice = randomUUID();
let pizzaria: { id: string; owner_id: string };
let burger: { id: string; owner_id: string };
let printerId: string;
let orderBefore: string;
let orderAfter: string;

beforeAll(async () => {
  [pizzaria] = await sql`select id, owner_id from stores where slug = 'pizzaria-forno-de-barro'`;
  [burger] = await sql`select id, owner_id from stores where slug = 'brasa-burger'`;
  // Dois pedidos recentes da pizzaria: um antes e um depois de ligar a impressão automática.
  const recent = await sql<{ id: string }[]>`
    select id from orders where store_id = ${pizzaria.id} and status = 'delivered' order by paid_at desc limit 2`;
  [orderAfter, orderBefore] = recent.map((row) => row.id);
  const real = new Date();
  await sql`update orders set paid_at = ${new Date(real.getTime() - 60 * 60_000)} where id = ${orderBefore}`;
  await sql`update orders set paid_at = ${new Date(real.getTime() - 5 * 60_000)} where id = ${orderAfter}`;
  const [printer] = await sql`
    insert into store_printers (store_id, name, sector, print_kind, paper_width_mm, copies, auto_print, auto_since, is_default, device_id, device_label)
    values (${pizzaria.id}, 'Caixa', 'caixa', 'completo', 58, 2, true, ${new Date(real.getTime() - 30 * 60_000)}, true, ${device}, 'Teste')
    returning id`;
  printerId = printer.id;
});

afterAll(async () => {
  await sql`delete from print_jobs where store_id in (${pizzaria.id}, ${burger.id})`;
  await sql`delete from store_printers where store_id in (${pizzaria.id}, ${burger.id})`;
  await Promise.all([sql.end(), appSql.end()]);
});

describe("fila de impressão", () => {
  it("imprime sozinho só o pedido que chegou depois de ligar a impressão automática, uma vez só", async () => {
    const claim = () => claimJobs({ storeId: pizzaria.id, deviceId: device, profileId: pizzaria.owner_id });
    // Duas abas olhando a fila ao mesmo tempo.
    const [first, second] = await Promise.all([claim(), claim()]);
    let jobs = [...first, ...second];
    // O que tem que sair: os pedidos que chegaram depois de ligar a impressão automática
    // (o do teste e os "ao vivo" do seed), cada um uma vez.
    const expected = await sql<{ code: string }[]>`
      select o.code from orders o join store_printers p on p.id = ${printerId}
      where o.store_id = ${pizzaria.id} and o.paid_at >= p.auto_since and o.status not in ('rejected', 'cancelled', 'expired', 'awaiting_payment')`;
    // A fila entrega até 5 por volta: pega o resto (se houver) antes de conferir.
    for (let more = await claim(); more.length > 0; more = await claim()) jobs = [...jobs, ...more];
    expect(jobs.map((job) => job.orderCode).sort()).toEqual(expected.map((row) => row.code).sort());
    expect(new Set(jobs.map((job) => job.orderCode)).size).toBe(jobs.length);
    const [order] = await sql`select code from orders where id = ${orderAfter}`;
    const [before] = await sql`select code from orders where id = ${orderBefore}`;
    expect(jobs.map((job) => job.orderCode)).toContain(order.code);
    expect(jobs.map((job) => job.orderCode)).not.toContain(before.code);
    const mine = jobs.find((job) => job.orderCode === order.code)!;
    const text = Buffer.from(mine.bytes, "base64").toString("latin1");
    expect(text).toContain(`Pedido ${order.code}`);
    expect(text).toContain("Via 2 de 2");

    // Recarregar a página, reconectar, olhar de novo: nada novo.
    await ensureAutoJobs(pizzaria.id, device, new Date());
    expect(await claim()).toEqual([]);
    expect((await sql`select count(*)::int as n from print_jobs where printer_id = ${printerId}`)[0].n).toBe(expected.length);

    expect(await finishJob({ storeId: pizzaria.id, jobId: mine.id, ok: true })).toBe(true);
    // Resultado repetido não muda nada.
    expect(await finishJob({ storeId: pizzaria.id, jobId: mine.id, ok: false, error: "x" })).toBe(false);
    expect((await sql`select status from print_jobs where id = ${mine.id}`)[0].status).toBe("sent");
  });

  it("outro aparelho não pega os trabalhos desta impressora", async () => {
    const job = await requestJob({ storeId: pizzaria.id, printerId, orderId: orderBefore, kind: "cozinha", profileId: pizzaria.owner_id });
    expect(job).not.toBeNull();
    expect(await claimJobs({ storeId: pizzaria.id, deviceId: otherDevice, profileId: pizzaria.owner_id })).toEqual([]);
    const mine = await claimJobs({ storeId: pizzaria.id, deviceId: device, profileId: pizzaria.owner_id });
    expect(mine.map((item) => item.kind)).toEqual(["cozinha"]);
    // Comanda da cozinha não leva valores.
    expect(Buffer.from(mine[0].bytes, "base64").toString("latin1")).not.toContain("R$");
    await finishJob({ storeId: pizzaria.id, jobId: mine[0].id, ok: false, error: "Impressora desligada" });
    expect((await sql`select status, error from print_jobs where id = ${mine[0].id}`)[0]).toEqual({ status: "failed", error: "Impressora desligada" });
  });

  it("envio sem resposta vira 'resultado desconhecido' e pode ser reimpresso", async () => {
    const job = await requestJob({ storeId: pizzaria.id, printerId, orderId: null, kind: "teste", profileId: pizzaria.owner_id });
    await sql`update print_jobs set status = 'sending', claimed_at = now() - interval '10 minutes' where id = ${job}`;
    await claimJobs({ storeId: pizzaria.id, deviceId: device, profileId: pizzaria.owner_id });
    expect((await sql`select status from print_jobs where id = ${job}`)[0].status).toBe("unknown");
  });

  it("uma loja não imprime pedido de outra nem usa a impressora de outra", async () => {
    const [foreignOrder] = await sql`select id from orders where store_id = ${burger.id} and paid_at is not null limit 1`;
    expect(await requestJob({ storeId: pizzaria.id, printerId, orderId: foreignOrder.id, kind: "completo", profileId: pizzaria.owner_id })).toBeNull();
    expect(await requestJob({ storeId: burger.id, printerId, orderId: null, kind: "teste", profileId: burger.owner_id })).toBeNull();
    const [job] = await sql`select id from print_jobs where store_id = ${pizzaria.id} limit 1`;
    expect(await finishJob({ storeId: burger.id, jobId: job.id, ok: true })).toBe(false);
  });

  it("pelo navegador ninguém grava impressora nem trabalho, e cada loja só vê os seus", () =>
    inRolledBackTransaction(async (tx) => {
      const denied = /permission denied/;
      await expect(asUser(tx, burger.owner_id, (q) => q`insert into store_printers (store_id, name) values (${pizzaria.id}, 'Intrusa')`)).rejects.toThrow(denied);
      await expect(asUser(tx, pizzaria.owner_id, (q) => q`update print_jobs set status = 'sent'`)).rejects.toThrow(denied);
      expect(await asUser(tx, burger.owner_id, (q) => q`select id from store_printers where store_id = ${pizzaria.id}`)).toHaveLength(0);
      expect(await asUser(tx, burger.owner_id, (q) => q`select id from print_jobs where store_id = ${pizzaria.id}`)).toHaveLength(0);
      expect(await asUser(tx, pizzaria.owner_id, (q) => q`select id from store_printers where store_id = ${pizzaria.id}`)).toHaveLength(1);
    }));
});
