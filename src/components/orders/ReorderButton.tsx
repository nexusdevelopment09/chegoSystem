"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reorder } from "@/app/pedidos/more-actions";
import { Button } from "@/components/ui/Button";
import { writeCart } from "@/lib/cart/local";

/** "Pedir de novo": refills the cart with what is still available and tells what changed. */
export function ReorderButton({ orderId, className }: { orderId: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [ready, setReady] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result = await reorder(orderId);
      if (result.cart) writeCart(result.cart);
      if (result.notes.length === 0 && result.cart) return router.push("/carrinho");
      setNotes(result.notes);
      setReady(Boolean(result.cart));
    } catch {
      setNotes(["Você está sem internet. Assim que voltar, a gente continua."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={run}>
        {busy ? "Montando a sacola..." : "Pedir de novo"}
      </Button>
      {notes && (
        <div role="alert" data-testid="reorder-notes" className="mt-2 rounded-2xl bg-peach px-4 py-3 text-sm">
          <p className="font-bold">{ready ? "Sua sacola foi montada, mas atenção:" : "Não deu para pedir de novo:"}</p>
          <ul className="list-disc pl-5">
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
          {ready && (
            <Button type="button" className="mt-2 min-h-11 px-4 text-sm" onClick={() => router.push("/carrinho")}>Ver a sacola</Button>
          )}
        </div>
      )}
    </div>
  );
}
