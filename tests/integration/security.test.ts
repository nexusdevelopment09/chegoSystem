import { afterAll, describe, expect, it } from "vitest";
import { asUser, createWorld, inRolledBackTransaction, sql } from "./helpers";

// Auditoria de segurança (docs/AUDITORIA_SEGURANCA.md): tentativas controladas de uma loja
// mexer no que é de outra, e de qualquer usuário mexer em dinheiro, com lojas sintéticas.
// Tudo dentro de uma transação desfeita no fim: nada fica no banco.

afterAll(() => sql.end());

const denied = /permission denied/;

async function withFees(tx: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0]) {
  const w = await createWorld(tx);
  const [closingB] = await tx`
    insert into store_closings (store_id, business_date, status, order_count, fees_cents, credits_cents, adjustments_cents,
                                total_due_cents, fee_unit_cents, due_date, closed_at)
    values (${w.storeB}, '2026-10-09', 'awaiting_payment', 1, 50, 0, 0, 50, 50, '2026-10-12', now()) returning id`;
  await tx`
    insert into fee_entries (store_id, order_id, kind, amount_cents, business_date, closing_id) values
      (${w.storeA}, ${w.orderA1}, 'order_fee', 50, '2026-10-09', null),
      (${w.storeB}, ${w.orderB}, 'order_fee', 50, '2026-10-09', ${closingB.id})`;
  return { ...w, closingB: closingB.id as string };
}

describe("auditoria: isolamento entre lojas", () => {
  it("o dono vê só as taxas e os fechamentos da própria loja; atendente não vê dinheiro", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await withFees(tx);
      const ownEntries = await asUser(tx, w.ownerA, (q) => q`select store_id from fee_entries`);
      expect(ownEntries.map((row) => row.store_id)).toEqual([w.storeA]);
      expect(await asUser(tx, w.ownerA, (q) => q`select id from store_closings where id = ${w.closingB}`)).toHaveLength(0);
      expect(await asUser(tx, w.attendantB, (q) => q`select id from fee_entries`)).toHaveLength(0);
      expect(await asUser(tx, w.ownerB, (q) => q`select id from store_closings where id = ${w.closingB}`)).toHaveLength(1);
    }));

  it("ninguém cria, apaga ou muda taxas e fechamentos pelo lado do navegador", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await withFees(tx);
      await expect(asUser(tx, w.ownerB, (q) => q`update fee_entries set amount_cents = 1 where store_id = ${w.storeB}`)).rejects.toThrow(denied);
      await expect(asUser(tx, w.ownerB, (q) => q`delete from fee_entries where store_id = ${w.storeB}`)).rejects.toThrow(denied);
      await expect(asUser(tx, w.ownerB, (q) =>
        q`insert into fee_entries (store_id, kind, amount_cents, business_date) values (${w.storeB}, 'carryover', -5000, '2026-10-09')`)).rejects.toThrow(denied);
      await expect(asUser(tx, w.ownerB, (q) => q`update store_closings set status = 'paid', total_due_cents = 0 where id = ${w.closingB}`)).rejects.toThrow(denied);
      await expect(asUser(tx, w.ownerB, (q) =>
        q`insert into fee_payments (charge_id, provider, provider_transaction_id, amount_cents, applied, received_at) values (gen_random_uuid(), 'x', 'y', 50, true, now())`)).rejects.toThrow(denied);
      // A tarifa de R$ 0,50 é configuração da plataforma: loja nenhuma muda.
      await expect(asUser(tx, w.ownerA, (q) => q`update platform_settings set value = '0' where key = 'order_fee_cents'`)).rejects.toThrow(denied);
      // Marcar o próprio pedido como entregue direto no banco também não.
      await expect(asUser(tx, w.ownerA, (q) => q`update orders set status = 'delivered' where id = ${w.orderA1}`)).rejects.toThrow(denied);
    }));

  it("subcategorias: loja não se coloca sozinha em vitrine nem cria subcategoria", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const [category] = await tx`select category_id from stores where id = ${w.storeA}`;
      const [sub] = await tx`insert into subcategories (category_id, name, slug) values (${category.category_id}, 'Teste', 'teste-audit') returning id`;
      await expect(asUser(tx, w.ownerA, (q) =>
        q`insert into store_subcategories (store_id, subcategory_id) values (${w.storeA}, ${sub.id})`)).rejects.toThrow(denied);
      await expect(asUser(tx, w.ownerA, (q) =>
        q`insert into subcategories (category_id, name, slug) values (${category.category_id}, 'Minha', 'minha')`)).rejects.toThrow(denied);
      // Mas todos leem (é o que monta os filtros).
      expect(await asUser(tx, null, (q) => q`select id from subcategories where id = ${sub.id}`)).toHaveLength(1);
    }));

  it("oferta: uma loja não mexe no preço 'de' da outra, e o banco recusa 'de' menor que o preço", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      const foreign = await asUser(tx, w.ownerA, (q) =>
        q`update products set compare_at_price_cents = 99999 where id = ${w.productB} returning id`);
      expect(foreign).toHaveLength(0);
      await expect(asUser(tx, w.ownerA, (q) =>
        q`update products set compare_at_price_cents = 500 where id = ${w.productA}`)).rejects.toThrow(/products_compare_at_check/);
      const own = await asUser(tx, w.ownerA, (q) =>
        q`update products set compare_at_price_cents = 1500 where id = ${w.productA} returning id`);
      expect(own).toHaveLength(1);
    }));

  it("uma loja não lê o endereço, o telefone ou o perfil do cliente de outra loja", () =>
    inRolledBackTransaction(async (tx) => {
      const w = await createWorld(tx);
      expect(await asUser(tx, w.ownerA, (q) => q`select id from orders where id = ${w.orderB}`)).toHaveLength(0);
      expect(await asUser(tx, w.ownerA, (q) => q`select id from addresses`)).toHaveLength(0);
      expect(await asUser(tx, w.ownerA, (q) => q`select id from profiles where id = ${w.customerB}`)).toHaveLength(0);
      expect(await asUser(tx, w.ownerA, (q) => q`select store_id from store_private where store_id = ${w.storeB}`)).toHaveLength(0);
    }));
});
