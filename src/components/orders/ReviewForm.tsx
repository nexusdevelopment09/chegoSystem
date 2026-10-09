"use client";

import { useState } from "react";
import { submitReview } from "@/app/pedidos/more-actions";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { inputClass } from "@/components/ui/Field";

const LABELS = ["", "Muito ruim", "Ruim", "Mais ou menos", "Bom", "Muito bom"];

/** Stars from 1 to 5 and an optional comment, once per order. */
export function ReviewForm({ orderId, storeName }: { orderId: string; storeName: string }) {
  const [rating, setRating] = useState(0);

  return (
    <ActionForm action={submitReview} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="rating" value={rating || ""} />
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Como foi seu pedido na {storeName}?</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="Nota de 1 a 5 estrelas">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} estrela${value > 1 ? "s" : ""}: ${LABELS[value]}`}
              onClick={() => setRating(value)}
              className={`flex size-12 items-center justify-center rounded-full text-3xl ${value <= rating ? "text-brand-dark" : "text-peach"}`}
            >
              ★
            </button>
          ))}
        </div>
        <p className="min-h-5 text-sm text-coffee-soft" aria-live="polite">{LABELS[rating]}</p>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Quer contar mais? (opcional)
        <textarea name="comment" maxLength={500} rows={3} className={`${inputClass} py-3 font-normal`} />
      </label>
      <SubmitButton className="self-start" >Enviar avaliação</SubmitButton>
    </ActionForm>
  );
}
