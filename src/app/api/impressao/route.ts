import { z } from "zod";
import { getCurrentProfile, getStoreMemberships } from "@/lib/auth/session";
import { claimJobs, finishJob } from "@/lib/printing/jobs";

// Fila de impressão do celular da loja. Rota comum (não Server Action) porque é chamada em
// segundo plano, de tempos em tempos, e não pode redesenhar a página.
//   { action: "claim", deviceId }               -> próximos trabalhos deste aparelho, com os bytes
//   { action: "finish", jobId, ok, error? }     -> resultado do envio
// A loja vem sempre de quem está logado (dono ou atendente), nunca do corpo da requisição.

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), deviceId: z.uuid(), printerId: z.uuid().optional() }),
  z.object({ action: z.literal("finish"), jobId: z.uuid(), ok: z.boolean(), error: z.string().max(300).optional() }),
]);

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  const membership = (await getStoreMemberships(profile.id)).find((item) => item.role === "owner" || item.role === "attendant");
  if (!membership) return new Response("Forbidden", { status: 403 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  if (parsed.data.action === "claim") {
    const jobs = await claimJobs({ storeId: membership.storeId, deviceId: parsed.data.deviceId, profileId: profile.id, printerId: parsed.data.printerId });
    return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
  }
  const updated = await finishJob({ storeId: membership.storeId, jobId: parsed.data.jobId, ok: parsed.data.ok, error: parsed.data.error });
  return Response.json({ updated });
}
