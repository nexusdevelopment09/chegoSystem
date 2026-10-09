"use client";

import Link from "next/link";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { useQuote } from "@/components/cart/useQuote";
import { Button, buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { clearCart, setCartNotes, updateCartItem, useCart, useCoupon, writeCoupon } from "@/lib/cart/local";
import { formatCents } from "@/lib/format";

export function CartView() {
  const cart = useCart();
  const coupon = useCoupon();
  const state = useQuote(cart, { couponCode: coupon || null });

  if (!cart) {
    return (
      <div className="rounded-card bg-white p-8 text-center ring-1 ring-peach">
        <p className="text-xl font-semibold">Sua sacola está vazia.</p>
        <p className="mb-4 text-coffee-soft">Bora escolher alguma coisa gostosa?</p>
        <Link href="/" className={buttonClass("primary")}>Ver as lojas</Link>
      </div>
    );
  }

  const quote = state.quote;
  const lineOf = (key: string) => quote?.lines.find((line) => line.key === key);
  // Problems that are solved on the next page (login, address) do not block going on.
  const blocking = quote ? quote.lines.some((line) => line.error) || quote.missingForMinCents > 0 : true;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-coffee-soft">
        Pedido na <Link href={`/loja/${cart.storeSlug}`} className="font-bold text-brand-dark underline">{cart.storeName}</Link>
      </p>

      <ul className="flex flex-col gap-2">
        {cart.items.map((item) => {
          const line = lineOf(item.key);
          const unit = line && !line.error ? line.unitPriceCents : item.unitPriceCents;
          return (
            <li key={item.key} data-testid="cart-item" className="rounded-card bg-white p-4 shadow-sm ring-1 ring-peach">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{item.name}</p>
                  {item.lines.map((text) => (
                    <p key={text} className="text-sm text-coffee-soft">{text}</p>
                  ))}
                  {item.notes && <p className="text-sm text-coffee-soft">Obs: {item.notes}</p>}
                  {line?.error && <p className="text-sm font-bold text-danger" role="alert">{line.error}</p>}
                </div>
                <p className="shrink-0 font-bold">{formatCents(unit * item.quantity)}</p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1 rounded-full bg-cream px-1">
                  <button type="button" aria-label={`Diminuir ${item.name}`} className="size-11 text-2xl font-bold text-brand-dark"
                    onClick={() => updateCartItem(item.key, { quantity: item.quantity - 1 })}>−</button>
                  <span className="w-6 text-center font-bold" data-testid="cart-quantity">{item.quantity}</span>
                  <button type="button" aria-label={`Aumentar ${item.name}`} className="size-11 text-2xl font-bold text-brand-dark"
                    onClick={() => updateCartItem(item.key, { quantity: item.quantity + 1 })}>+</button>
                </div>
                <button type="button" className="min-h-11 px-3 text-sm font-bold text-danger underline"
                  onClick={() => updateCartItem(item.key, { quantity: 0 })}>Remover</button>
              </div>
            </li>
          );
        })}
      </ul>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Observação para a loja
        <textarea defaultValue={cart.notes} onBlur={(event) => setCartNotes(event.target.value.slice(0, 300))} maxLength={300} rows={2}
          className="rounded-2xl border-2 border-peach bg-white px-4 py-3 text-base font-normal focus:border-brand-dark focus:outline-none" />
      </label>

      <form
        className="flex flex-col gap-2 rounded-card bg-white p-4 ring-1 ring-peach"
        onSubmit={(event) => {
          event.preventDefault();
          const field = new FormData(event.currentTarget).get("coupon");
          writeCoupon(String(field ?? "").trim().toUpperCase());
        }}
      >
        <label htmlFor="coupon" className="text-sm font-semibold">Cupom de desconto</label>
        <div className="flex gap-2">
          <input id="coupon" name="coupon" key={coupon} defaultValue={coupon} maxLength={30}
            autoCapitalize="characters" autoComplete="off" className={`${inputClass} uppercase`} />
          <Button type="submit" variant="secondary" className="shrink-0">Aplicar</Button>
        </div>
        {quote?.coupon && (
          <p role="status" data-testid="coupon-message" className={`text-sm font-bold ${quote.coupon.ok ? "text-success" : "text-danger"}`}>
            {quote.coupon.message}
          </p>
        )}
      </form>

      <section className="rounded-card bg-white p-4 ring-1 ring-peach" aria-busy={state.status === "loading"}>
        {state.status === "error" ? (
          <p role="alert" className="font-semibold text-danger">{state.message}</p>
        ) : !quote ? (
          <div className="h-32 animate-pulse rounded-2xl bg-peach" aria-label="Calculando" />
        ) : (
          <>
            {quote.warnings.map((warning) => (
              <p key={warning} role="status" className="mb-2 rounded-2xl bg-peach px-3 py-2 text-sm font-semibold">{warning}</p>
            ))}
            <OrderSummary totals={quote.totals} fulfillment={quote.fulfillment} />
            {quote.delivery.neighborhoodName && (
              <p className="mt-1 text-sm text-coffee-soft">
                {quote.delivery.available ? `Entrega em ${quote.delivery.neighborhoodName}.` : quote.delivery.reason}
              </p>
            )}
            {quote.missingForMinCents > 0 && (
              <p role="alert" data-testid="min-order" className="mt-2 rounded-2xl bg-peach px-3 py-2 text-sm font-bold text-brand-darker">
                Faltam {formatCents(quote.missingForMinCents)} para o pedido mínimo de {formatCents(quote.minOrderCents)}.
              </p>
            )}
          </>
        )}
      </section>

      <div className="flex flex-col gap-2">
        {blocking || state.status !== "ready" ? (
          <Button type="button" disabled>Continuar</Button>
        ) : (
          <Link href="/checkout" className={buttonClass("primary")}>Continuar</Link>
        )}
        <Button type="button" variant="secondary" onClick={() => { clearCart(); writeCoupon(""); }}>Esvaziar sacola</Button>
      </div>
    </div>
  );
}
