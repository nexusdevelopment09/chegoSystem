import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { setReviewHidden } from "../actions";

export const metadata: Metadata = { title: "Moderação" };

const RULES: Record<string, string> = {
  phone: "telefone", phone_spelled: "telefone por extenso", email: "e-mail", link: "link", handle: "@ de rede social",
  zap: "“zap”", whats: "“whats”", wpp: "“wpp”", social: "rede social", pix_direto: "pagamento por fora", me_chama: "pedido de contato",
};

export default function ModerationPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Moderation />
    </Suspense>
  );
}

async function Moderation() {
  await requireRole("admin");
  const [reviews, attempts] = await Promise.all([
    sql<{ id: string; rating: number; comment: string | null; store_name: string; customer: string; created_at: Date; reported_at: Date | null; hidden_at: Date | null; hidden_reason: string | null }[]>`
      select r.id, r.rating, r.comment, s.name as store_name, p.full_name as customer, r.created_at, r.reported_at, r.hidden_at, r.hidden_reason
      from reviews r join stores s on s.id = r.store_id join profiles p on p.id = r.customer_id
      where r.reported_at is not null or r.hidden_at is not null
      order by (r.hidden_at is null) desc, r.reported_at desc nulls last limit 60`,
    sql<{ id: string; body: string; matched_rule: string; sender: string; role: string; code: string; order_id: string; created_at: Date }[]>`
      select a.id, a.body, a.matched_rule, p.full_name as sender, p.role, o.code, o.id as order_id, a.created_at
      from blocked_message_attempts a join profiles p on p.id = a.sender_id join orders o on o.id = a.order_id
      order by a.created_at desc limit 80`,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">Moderação</h1>

      <section>
        <h2 className="mb-2 text-xl">Avaliações denunciadas ou ocultas</h2>
        {reviews.length === 0 && <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma avaliação para analisar.</p>}
        <ul className="flex flex-col gap-2">
          {reviews.map((review) => (
            <li key={review.id} data-testid="moderation-review" className="flex flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-peach">
              <p className="text-sm">
                <strong>{"★".repeat(review.rating)}</strong> · {review.customer} sobre {review.store_name} · {formatDateTime(review.created_at)}
                {review.hidden_at && <span className="ml-2 rounded-full bg-coffee px-2 py-0.5 text-xs font-bold text-peach">Oculta</span>}
              </p>
              <p>{review.comment ?? <span className="text-coffee-soft">Sem comentário.</span>}</p>
              {review.hidden_reason && <p className="text-sm text-coffee-soft">Motivo: {review.hidden_reason}</p>}
              <ActionForm action={setReviewHidden} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={review.id} />
                <input type="hidden" name="hide" value={review.hidden_at ? "0" : "1"} />
                {!review.hidden_at && (
                  <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
                    Motivo para ocultar
                    <input name="reason" required maxLength={300} className={inputClass} />
                  </label>
                )}
                <SubmitButton variant="secondary" className="min-h-12 px-4 text-sm">{review.hidden_at ? "Mostrar de novo" : "Ocultar avaliação"}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-xl">Tentativas bloqueadas de troca de contato</h2>
        {attempts.length === 0 && <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma tentativa registrada.</p>}
        <ul className="flex flex-col gap-2">
          {attempts.map((attempt) => (
            <li key={attempt.id} data-testid="blocked-attempt" className="rounded-card bg-white p-3 ring-1 ring-peach">
              <p className="text-sm text-coffee-soft">
                {attempt.sender} ({attempt.role === "customer" ? "cliente" : "loja"}) · pedido{" "}
                <Link href={`/admin/pedidos/${attempt.order_id}`} className="font-semibold text-brand-dark underline">{attempt.code}</Link> ·{" "}
                {formatDateTime(attempt.created_at)} · bloqueado por {RULES[attempt.matched_rule] ?? attempt.matched_rule}
              </p>
              <p className="break-words">{attempt.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
