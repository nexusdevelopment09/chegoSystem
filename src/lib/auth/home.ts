import type { UserRole } from "./session";

/** Onde cada tipo de usuário cai depois de entrar. */
export const homeFor = (role: UserRole) => (role === "admin" ? "/admin" : role === "merchant" ? "/lojista" : "/");
