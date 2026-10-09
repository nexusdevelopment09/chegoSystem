"use server";

import { redirect } from "next/navigation";
import { destroyAllSessions, getCurrentProfile } from "@/lib/auth/session";

export async function signOutEverywhere() {
  const profile = await getCurrentProfile();
  if (profile) await destroyAllSessions(profile.id);
  redirect("/entrar");
}
