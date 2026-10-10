/** Verdadeiro enquanto o app roda no ambiente de testes, nunca em produção. */
export const isLocalEnv = process.env.APP_ENV === "local";

export const TIME_ZONE = "America/Maceio";

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "Missing environment variable DATABASE_URL. Copy .env.example to .env.local.",
    );
  }
  return value;
}
