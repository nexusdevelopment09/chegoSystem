import type { UserRole } from "./session";

/** Where each kind of user lands after signing in. */
export const homeFor = (role: UserRole) => (role === "admin" ? "/admin" : role === "merchant" ? "/lojista" : "/");
