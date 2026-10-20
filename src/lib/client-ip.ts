// Endereço do visitante a partir dos cabeçalhos do proxy. Função pura.

/**
 * O último endereço de X-Forwarded-For é o que o nosso proxy (Caddy ou nginx) acrescentou;
 * o primeiro vem do próprio visitante e pode ser inventado para fugir dos limites.
 */
export function ipFromHeaders(forwardedFor: string | null, realIp: string | null): string {
  const forwarded = forwardedFor?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  return forwarded.at(-1) || realIp?.trim() || "local";
}
