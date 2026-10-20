import "server-only";
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";

// Pedido feito sem conta: o visitante acompanha por um link com um token aleatório.
// Só o hash vai para o banco, então uma tabela vazada não abre pedido nenhum.

export const hashGuestToken = (token: string) => createHash("sha256").update(token).digest("hex");

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** O id do pedido daquele link, ou null (token com formato errado ou que não existe). */
export async function guestOrderId(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await sql<{ id: string }[]>`
    select id from orders where guest_token_hash = ${hashGuestToken(token)} and customer_id is null`;
  return row?.id ?? null;
}
