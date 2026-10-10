import type { Metadata } from "next";
import { Suspense } from "react";
import { Rating } from "@/components/store/StoreCard";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { replyReview, reportReview } from "../owner-actions";

export const metadata: Metadata = { title: "Avaliações" };

export default function StoreReviewsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Reviews />
    </Suspense>
  );
}

async function Reviews() {
  const { store } = await getMerchantContext(["owner", "attendant"]);
  const [[summary], reviews] = await Promise.all([
    sql<{ rating_avg: string | null; rating_count: number }[]>`select rating_avg, rating_count from stores where id = ${store.id}`,
    // The customer's first name is fine to show; the phone and the rest stay private.
    sql<{ id: string; rating: number; comment: string | null; reply: string | null; first_name: string; code: string; created_at: Date; reported_at: Date | null; hidden_at: Date | null }[]>`
      select r.id, r.rating, r.comment, r.reply, split_part(p.full_name, ' ', 1) as first_name, o.code, r.created_at, r.reported_at, r.hidden_at
      from reviews r join profiles p on p.id = r.customer_id join orders o on o.id = r.order_id
      where r.store_id = ${store.id}
      order by r.created_at desc limit 60`,
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <header>
        <h1 className="text-3xl">Avaliações</h1>
        <p className="text-lg">
          <Rating avg={summary.rating_avg === null ? null : Number(summary.rating_avg)} count={summary.rating_count} />
          <span className="text-sm text-coffee-soft"> · média dos últimos 180 dias</span>
        </p>
      </header>

      {reviews.length === 0 && <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhuma avaliação ainda.</p>}

      {reviews.map((review) => (
        <article key={review.id} data-testid="merchant-review" className={`flex flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-peach ${review.hidden_at ? "grayscale" : ""}`}>
          <p className="text-sm">
            <span className="font-bold text-brand-dark" aria-label={`${review.rating} de 5 estrelas`}>
              {"★".repeat(review.rating)}<span className="text-peach">{"★".repeat(5 - review.rating)}</span>
            </span>{" "}
            {review.first_name} · pedido {review.code} · <span className="text-coffee-soft">{formatDateTime(review.created_at)}</span>
          </p>
          {review.comment ? <p>{review.comment}</p> : <p className="text-sm text-coffee-soft">Sem comentário.</p>}
          {review.hidden_at && <p className="text-sm font-bold text-danger">Ocultada pela plataforma.</p>}

          {review.reply ? (
            <p className="rounded-2xl bg-cream px-3 py-2 text-sm"><strong>Sua resposta:</strong> {review.reply}</p>
          ) : (
            !review.hidden_at && (
              <ActionForm action={replyReview} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={review.id} />
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Responder (todo mundo vê)
                  <textarea name="reply" required maxLength={500} rows={2} className={`${inputClass} py-3 font-normal`} />
                </label>
                <SubmitButton variant="secondary" className="min-h-11 self-start px-4 text-sm">Publicar resposta</SubmitButton>
              </ActionForm>
            )
          )}

          {!review.hidden_at && (review.reported_at ? (
            <p className="text-sm text-coffee-soft">Denunciada. A plataforma vai analisar.</p>
          ) : (
            <form action={reportReview}>
              <input type="hidden" name="id" value={review.id} />
              <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm">Denunciar avaliação ofensiva</Button>
            </form>
          ))}
        </article>
      ))}
    </div>
  );
}
