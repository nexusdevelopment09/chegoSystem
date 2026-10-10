"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { withUser } from "@/lib/db";

/** Adiciona ou remove uma loja dos favoritos do cliente. */
export async function toggleFavorite(formData: FormData) {
  const storeId = z.uuid().parse(formData.get("storeId"));
  const slug = z.string().max(120).parse(formData.get("slug"));

  const profile = await getCurrentProfile();
  if (!profile) redirect("/entrar");

  // Roda como o usuário: as regras de acesso por linha (RLS) só deixam mexer nos próprios favoritos.
  await withUser(profile.id, async (tx) => {
    const removed = await tx`delete from favorites where profile_id = ${profile.id} and store_id = ${storeId} returning store_id`;
    if (removed.length === 0) {
      await tx`insert into favorites (profile_id, store_id) values (${profile.id}, ${storeId})`;
    }
  });

  revalidatePath(`/loja/${slug}`);
  revalidatePath("/favoritos");
}
