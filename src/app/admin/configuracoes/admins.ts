"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export type ActionState = { error?: string; ok?: boolean; message?: string };

/**
 * Torna um admin super admin, ou tira. Só um super admin faz isso, nunca em si mesmo, e a
 * plataforma nunca fica sem nenhum super admin. Não cria admins: isso segue fora do app.
 */
export async function setSuperAdmin(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSuperAdmin();
  const id = z.uuid().safeParse(formData.get("id"));
  const grant = formData.get("grant") === "1";
  if (!id.success) return { error: "Admin inválido." };
  if (id.data === profile.id) return { error: "Ninguém altera o próprio acesso de super admin." };
  const result = await sql.begin(async (tx) => {
    await tx`select id from profiles where role = 'admin' and is_super_admin for update`;
    const [target] = await tx<{ name: string; is_super_admin: boolean }[]>`
      select full_name as name, is_super_admin from profiles where id = ${id.data} and role = 'admin' and deleted_at is null for update`;
    if (!target) return "Admin não encontrado.";
    if (target.is_super_admin === grant) return null;
    if (!grant) {
      const [{ supers }] = await tx<{ supers: number }[]>`select count(*)::int as supers from profiles where role = 'admin' and is_super_admin and deleted_at is null`;
      if (supers <= 1) return "A plataforma precisa ter pelo menos um super admin.";
    }
    await tx`update profiles set is_super_admin = ${grant} where id = ${id.data}`;
    await audit({ actorId: profile.id, actorRole: "admin", module: "admin", action: grant ? "admin.super_concedido" : "admin.super_removido", entityType: "profile", entityId: id.data,
      details: { admin: target.name, antes: target.is_super_admin, depois: grant } }, tx);
    return null;
  });
  if (result) return { error: result };
  revalidatePath("/admin", "layout");
  return { ok: true, message: grant ? "Agora é super admin." : "Deixou de ser super admin." };
}
