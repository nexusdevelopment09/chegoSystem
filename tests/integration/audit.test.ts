import { afterAll, describe, expect, it, vi } from "vitest";
import { inRolledBackTransaction, sql } from "./helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { sql as appSql } from "@/lib/db";
import { listStoreAudit, redactSecrets } from "@/lib/merchant/audit-log";
import { transitionOrder } from "@/lib/orders/transitions";

// Auditoria: o que é registrado, quem consegue ler e que nada se altera.

afterAll(async () => {
  await Promise.all([appSql.end(), sql.end()]);
});

describe("auditoria", () => {
  it("mudança de status do pedido fica registrada na mesma transação, com de/para", () =>
    inRolledBackTransaction(async (tx) => {
      const [order] = await tx`select o.id, o.code, s.owner_id from orders o join stores s on s.id = o.store_id where o.status = 'preparing' limit 1`;
      await transitionOrder(tx, { orderId: order.id, to: "ready", actor: "staff", actorId: order.owner_id, at: new Date() });
      const [log] = await tx`select action, actor_id, actor_role, module, result, details from audit_logs where entity_id = ${order.id} and action = 'pedidos.status'`;
      expect(log).toMatchObject({ actor_id: order.owner_id, actor_role: "staff", module: "pedidos", result: "ok", details: { code: order.code, from: "preparing", to: "ready" } });
    }));

  it("eventos não podem ser alterados nem apagados", () =>
    inRolledBackTransaction(async (tx) => {
      const [log] = await tx`insert into audit_logs (actor_id, action, entity_type) values (null, 'teste.x', 'store') returning id`;
      await expect(tx.savepoint((sp) => sp`update audit_logs set action = 'outra' where id = ${log.id}`)).rejects.toThrow(/não podem ser alterados/);
      await expect(tx.savepoint((sp) => sp`delete from audit_logs where id = ${log.id}`)).rejects.toThrow(/retenção/);
    }));

  it("a loja vê os próprios eventos e as entradas da equipe, nunca os de outra loja", async () => {
    const [mine] = await sql`select id, owner_id from stores where slug = 'pizzaria-forno-de-barro'`;
    const [other] = await sql`select id, owner_id from stores where slug = 'brasa-burger'`;
    const tag = `t${Date.now()}`;
    await sql`
      insert into audit_logs (actor_id, action, entity_type, entity_id, store_id, module, details) values
        (${mine.owner_id}, ${`${tag}.minha`}, 'store', ${mine.id}, ${mine.id}, 'loja', ${sql.json({ token: "abc", antes: { senha: "x", nome: "A" } })}),
        (${other.owner_id}, ${`${tag}.outra`}, 'store', ${other.id}, ${other.id}, 'loja', '{}'),
        (${mine.owner_id}, 'auth.entrada', 'profile', ${mine.owner_id}, null, 'acesso', ${sql.json({ method: tag })}),
        (${other.owner_id}, 'auth.entrada', 'profile', ${other.owner_id}, null, 'acesso', ${sql.json({ method: tag })})`;

    const { rows } = await listStoreAudit(mine.id, { search: tag, limit: 50, offset: 0 });
    expect(rows.map((row) => row.action)).toEqual([`${tag}.minha`]);
    // Segredos nunca aparecem, mesmo dentro de outros campos.
    expect(rows[0].details).toEqual({ token: "••••", antes: { senha: "••••", nome: "A" } });

    const logins = await listStoreAudit(mine.id, { module: "acesso", limit: 200, offset: 0 });
    const ours = logins.rows.filter((row) => row.details.method === tag);
    expect(ours.map((row) => row.actorId)).toEqual([mine.owner_id]);
  });

  it("redação de segredos em listas e objetos aninhados", () => {
    expect(redactSecrets([{ password_hash: "x", ok: 1 }])).toEqual([{ password_hash: "••••", ok: 1 }]);
  });
});
