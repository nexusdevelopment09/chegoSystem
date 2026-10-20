import { createHash } from "node:crypto";

/** O convite guarda só o hash do código: quem lê o banco não consegue usar o link. */
export const hashInvite = (token: string) => createHash("sha256").update(token).digest("hex");
