import "server-only";
import { headers } from "next/headers";
import { ipFromHeaders } from "@/lib/client-ip";
import { sql } from "@/lib/db";

/**
 * Conta uma tentativa e diz se ela ainda é permitida.
 * Janela fixa guardada no banco, então não é preciso nenhum serviço extra.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (key, window_start)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}))
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;

  // Janelas antigas não servem para nada; limpa de vez em quando.
  if (Math.random() < 0.02) {
    await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  }
  return row.count <= limit;
}

/**
 * Melhor palpite do endereço do visitante, para os limites por IP. Usa o último endereço
 * de X-Forwarded-For, o que o nosso proxy (Caddy ou nginx) acrescentou: o primeiro vem do
 * próprio visitante e pode ser inventado para fugir do limite.
 */
export async function clientIp(): Promise<string> {
  const list = await headers();
  return ipFromHeaders(list.get("x-forwarded-for"), list.get("x-real-ip"));
}


export const TOO_MANY_ATTEMPTS = "Eita, muitas tentativas. Espera uns minutinhos e tenta de novo.";
