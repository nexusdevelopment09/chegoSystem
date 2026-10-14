import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// Guardado como "scrypt$<salt hex>$<hash hex>". Também é importado por db/seed.ts, então
// este arquivo não pode depender do Next.js nem do atalho "@/".
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;

/** O que há de errado com uma senha nova, ou null quando ela serve. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  if (/^(\d)\1+$/.test(password) || password === "12345678" || password === "123456789") return "Essa senha é fácil demais de adivinhar.";
  return null;
}

/**
 * Senha provisória para quem foi cadastrado por outra pessoa (equipe da loja, entregador
 * do Chegô) ou teve a senha trocada pelo admin. Oito números, fáceis de ditar.
 */
export function temporaryPassword(): string {
  return Array.from({ length: 8 }, () => randomInt(0, 10)).join("");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
