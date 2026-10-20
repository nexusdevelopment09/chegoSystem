"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { saveAddress, submitOrder } from "@/app/carrinho/actions";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { useQuote } from "@/components/cart/useQuote";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { clearCart, useCart, useCoupon, writeCoupon } from "@/lib/cart/local";
import { toCartPayload, type CheckoutChoices, type GuestDetails } from "@/lib/cart/payload";
import { quantityLabel } from "@/lib/catalog/weight";
import { formatCents, parseMoney } from "@/lib/format";
import { STORE_PAYMENT_LABELS } from "@/lib/payments/collection";

export type SavedAddress = { id: string; street: string; number: string; reference: string | null; neighborhood: string; neighborhoodId: string; isDefault: boolean };
type Neighborhood = { id: string; name: string; isRural: boolean };

type Props = {
  addresses: SavedAddress[];
  neighborhoods: Neighborhood[];
  cardEnabled: boolean;
  blocked: boolean;
  /** Sem conta: pede nome, telefone e o endereço aqui mesmo, sem salvar. */
  guest?: boolean;
};

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-white p-4 shadow-sm ring-1 ring-peach">
      <h2 className="mb-3 text-xl">{title}</h2>
      {children}
    </section>
  );
}

const choiceClass = (selected: boolean) =>
  `flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-2 ${selected ? "border-brand-dark bg-cream" : "border-peach bg-white"}`;

export function CheckoutForm({ addresses: initialAddresses, neighborhoods, cardEnabled, blocked, guest = false }: Props) {
  const router = useRouter();
  const cart = useCart();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [choices, setChoices] = useState<CheckoutChoices>({
    fulfillment: "delivery", addressId: initialAddresses[0]?.id ?? null, scheduledFor: null,
    couponCode: null, ageConfirmed: false, missingItemPolicy: null, paymentMethod: "pix",
  });
  const [chosenTiming, setTiming] = useState<"now" | "schedule">("now");
  const couponCode = useCoupon();
  const [addingAddress, setAddingAddress] = useState(initialAddresses.length === 0);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [card, setCard] = useState({ number: "", holder: "", expiry: "", cvv: "" });
  const [changeText, setChangeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [visitor, setVisitor] = useState<GuestDetails>({ name: "", phone: "", street: "", number: "", neighborhoodId: null, reference: "", complement: "" });
  const setGuest = (changes: Partial<GuestDetails>) => setVisitor((current) => ({ ...current, ...changes }));
  // Na cotação só o bairro importa (taxa de entrega); o resto vai só ao fechar o pedido.
  const guestPreview = guest ? { ...visitor, name: "", phone: "", street: "", number: "", reference: "", complement: "" } : null;

  // O horário agendado só vale enquanto "Agendar" for a opção escolhida.
  const state = useQuote(cart, { ...choices, guest: guestPreview, couponCode: couponCode || null, scheduledFor: chosenTiming === "schedule" ? choices.scheduledFor : null });
  const quote = state.quote;
  const set = (changes: CheckoutChoices) => setChoices((current) => ({ ...current, ...changes }));
  // Bairros em que a loja da sacola entrega (vêm do servidor). Enquanto não chegam, todos.
  const served = quote?.delivery.servedNeighborhoods ?? null;
  const servedIds = served ? new Set(served.map((hood) => hood.id)) : null;
  const hoodOptions = servedIds ? neighborhoods.filter((hood) => servedIds.has(hood.id)) : neighborhoods;
  const feeOf = (id: string) => served?.find((hood) => hood.id === id)?.feeCents ?? null;

  // Quando a loja não pode receber o pedido para agora, agendar é o único jeito.
  const mustSchedule = quote ? !quote.orderNow.allowed && quote.slots.length > 0 : false;
  const timing = mustSchedule ? "schedule" : chosenTiming;
  // A forma escolhida precisa ser uma das que a loja aceita; senão vale a primeira delas.
  const methods = quote?.payment.methods ?? [];
  const effectiveMethod = methods.length > 0 && !methods.includes(choices.paymentMethod ?? "pix") ? methods[0] : choices.paymentMethod ?? "pix";
  const effective = {
    ...choices, paymentMethod: effectiveMethod, cashChangeForCents: effectiveMethod === "cash" ? choices.cashChangeForCents ?? null : null,
    couponCode: couponCode || null, scheduledFor: timing === "schedule" ? choices.scheduledFor : null,
    guest: guest ? visitor : null, addressId: guest ? null : choices.addressId,
  };

  if (!cart) {
    return (
      <div className="rounded-card bg-white p-8 text-center ring-1 ring-peach">
        <p className="mb-4 text-xl font-semibold">Sua sacola está vazia.</p>
        <Link href="/" className={buttonClass("primary")}>Ver as lojas</Link>
      </div>
    );
  }

  async function addAddress(formData: FormData) {
    setAddressError(null);
    const hoodId = String(formData.get("neighborhoodId") ?? "");
    const response = await saveAddress({
      street: formData.get("street"), number: formData.get("number"), neighborhoodId: hoodId,
      reference: formData.get("reference"), complement: formData.get("complement"),
    });
    if (!response.ok) return setAddressError(response.error);

    const hood = neighborhoods.find((item) => item.id === hoodId);
    setAddresses((current) => [
      { id: response.addressId, street: String(formData.get("street")), number: String(formData.get("number") || "S/N"),
        reference: String(formData.get("reference") || "") || null, neighborhood: hood?.name ?? "", neighborhoodId: hoodId, isDefault: true },
      ...current,
    ]);
    set({ addressId: response.addressId });
    setAddingAddress(false);
  }

  async function submit() {
    if (!cart) return;
    if (timing === "schedule" && !choices.scheduledFor) return setErrors(["Escolha o dia e a hora do agendamento."]);
    setSubmitting(true);
    setErrors([]);
    try {
      const payload = toCartPayload(cart, effective);
      const response = await submitOrder(payload, choices.paymentMethod === "card" ? card : undefined);
      if (!response.ok) {
        setErrors(response.errors);
        return;
      }
      clearCart();
      writeCoupon("");
      router.push(response.next);
    } catch {
      setErrors(["Você está sem internet. Assim que voltar, a gente continua."]);
    } finally {
      setSubmitting(false);
    }
  }

  const delivery = choices.fulfillment === "delivery";

  return (
    <div className="flex flex-col gap-4">
      {blocked && (
        <p role="alert" className="rounded-2xl bg-peach px-4 py-3 font-bold text-danger">
          Sua conta está bloqueada para novos pedidos. Fale com o suporte.
        </p>
      )}

      {guest && (
        <Step title="Seus dados">
          <div className="flex flex-col gap-3" data-testid="guest-details">
            <p className="text-sm text-coffee-soft">
              Peça sem criar conta: a loja usa seu nome e telefone só para este pedido.{" "}
              <Link href="/entrar" className="font-semibold text-brand-dark underline">Já tenho conta</Link>
            </p>
            <Field label="Seu nome" autoComplete="name" maxLength={80} value={visitor.name} onChange={(event) => setGuest({ name: event.target.value })} />
            <Field label="Telefone (WhatsApp)" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="(82) 99999-9999" value={visitor.phone} onChange={(event) => setGuest({ phone: event.target.value })} />
          </div>
        </Step>
      )}

      <Step title="Como você quer receber?">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Entrega ou retirada">
          <label className={choiceClass(delivery)}>
            <input type="radio" name="fulfillment" checked={delivery} onChange={() => set({ fulfillment: "delivery" })} className="size-5 accent-brand-dark" />
            Entrega
          </label>
          <label className={choiceClass(!delivery)}>
            <input type="radio" name="fulfillment" checked={!delivery} onChange={() => set({ fulfillment: "pickup" })} className="size-5 accent-brand-dark" />
            Retirar no balcão
          </label>
        </div>
        {quote && delivery && !quote.delivery.available && (
          <p role="alert" data-testid="delivery-problem" className="mt-2 text-sm font-bold text-danger">{quote.delivery.reason}</p>
        )}
      </Step>

      {delivery && guest && (
        <Step title="Onde entregar?">
          <div className="flex flex-col gap-3">
            <Field label="Rua" maxLength={120} autoComplete="address-line1" value={visitor.street} onChange={(event) => setGuest({ street: event.target.value })} />
            <Field label="Número" maxLength={20} placeholder="S/N" value={visitor.number} onChange={(event) => setGuest({ number: event.target.value })} />
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Bairro ou comunidade
              <select value={visitor.neighborhoodId ?? ""} onChange={(event) => setGuest({ neighborhoodId: event.target.value || null })} className={inputClass}>
                <option value="" disabled>Escolha</option>
                {hoodOptions.map((hood) => {
                  const fee = feeOf(hood.id);
                  return <option key={hood.id} value={hood.id}>{hood.name}{hood.isRural ? " (zona rural)" : ""}{fee !== null ? ` · entrega ${fee === 0 ? "grátis" : formatCents(fee)}` : ""}</option>;
                })}
              </select>
              {servedIds && <span className="text-xs font-normal text-coffee-soft">Só aparecem os bairros onde esta loja entrega.</span>}
            </label>
            <Field label="Ponto de referência" maxLength={200} hint="Obrigatório na zona rural. Ex.: casa azul depois da ponte." value={visitor.reference} onChange={(event) => setGuest({ reference: event.target.value })} />
            <Field label="Complemento" maxLength={100} value={visitor.complement} onChange={(event) => setGuest({ complement: event.target.value })} />
          </div>
        </Step>
      )}

      {delivery && !guest && (
        <Step title="Onde entregar?">
          <div className="flex flex-col gap-2">
            {addresses.length > 0 && (
              <p className="text-sm text-coffee-soft" data-testid="address-confirm">
                Confira se o endereço continua certo: a taxa e o tempo de entrega dependem do bairro.
              </p>
            )}
            {addresses.map((address) => (
              <label key={address.id} className={choiceClass(choices.addressId === address.id)}>
                <input type="radio" name="address" checked={choices.addressId === address.id} onChange={() => set({ addressId: address.id })} className="size-5 shrink-0 accent-brand-dark" />
                <span>
                  <strong>{address.street}, {address.number}</strong> · {address.neighborhood}
                  {address.reference && <span className="block text-sm text-coffee-soft">Referência: {address.reference}</span>}
                  {servedIds && !servedIds.has(address.neighborhoodId) && (
                    <span className="block text-sm font-bold text-danger" data-testid="address-not-served">Esta loja não entrega em {address.neighborhood}.</span>
                  )}
                </span>
              </label>
            ))}

            {addingAddress ? (
              <form
                className="flex flex-col gap-3 rounded-2xl bg-cream p-3"
                onSubmit={(event) => {
                  // Enviado à mão para os campos não serem limpos se o endereço for recusado.
                  event.preventDefault();
                  void addAddress(new FormData(event.currentTarget));
                }}
              >
                <Field label="Rua" name="street" required maxLength={120} autoComplete="address-line1" />
                <Field label="Número" name="number" maxLength={20} placeholder="S/N" />
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Bairro ou comunidade
                  <select name="neighborhoodId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>Escolha</option>
                    {hoodOptions.map((hood) => {
                      const fee = feeOf(hood.id);
                      return (
                        <option key={hood.id} value={hood.id}>
                          {hood.name}{hood.isRural ? " (zona rural)" : ""}{fee !== null ? ` · entrega ${fee === 0 ? "grátis" : formatCents(fee)}` : ""}
                        </option>
                      );
                    })}
                  </select>
                  {servedIds && <span className="text-xs font-normal text-coffee-soft">Só aparecem os bairros onde esta loja entrega.</span>}
                </label>
                <Field label="Ponto de referência" name="reference" maxLength={200} hint="Obrigatório na zona rural. Ex.: casa azul depois da ponte." />
                <Field label="Complemento" name="complement" maxLength={100} />
                {addressError && <p role="alert" className="text-sm font-bold text-danger">{addressError}</p>}
                <Button type="submit">Salvar endereço</Button>
              </form>
            ) : (
              <Button type="button" variant="secondary" onClick={() => setAddingAddress(true)}>Novo endereço</Button>
            )}
          </div>
        </Step>
      )}

      <Step title="Quando?">
        <div className="flex flex-col gap-2">
          {quote?.orderNow.allowed ? (
            <label className={choiceClass(timing === "now")}>
              <input type="radio" name="timing" checked={timing === "now"} onChange={() => setTiming("now")} className="size-5 accent-brand-dark" />
              Agora (cerca de {quote.estimateMinutes} min)
            </label>
          ) : (
            quote && <p role="status" data-testid="now-blocked" className="rounded-2xl bg-peach px-3 py-2 text-sm font-semibold">{quote.orderNow.reason}</p>
          )}

          {quote && quote.slots.length > 0 && (
            <label className={choiceClass(timing === "schedule")}>
              <input type="radio" name="timing" checked={timing === "schedule"} onChange={() => setTiming("schedule")} className="size-5 shrink-0 accent-brand-dark" />
              <span className="flex flex-1 flex-col gap-1">
                Agendar
                {timing === "schedule" && (
                  <select aria-label="Dia e hora do agendamento" value={choices.scheduledFor ?? ""} onChange={(event) => set({ scheduledFor: event.target.value || null })} className={inputClass}>
                    <option value="">Escolha o dia e a hora</option>
                    {quote.slots.map((slot) => (
                      <option key={slot.value} value={slot.value}>{slot.label}</option>
                    ))}
                  </select>
                )}
              </span>
            </label>
          )}
        </div>
      </Step>

      {quote?.store.isMarket && (
        <Step title="E se faltar um item?">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="O que fazer se faltar um item">
            {([["call", "Me ligar"], ["substitute", "Substituir por similar"], ["remove", "Remover o item (sai do total)"]] as const).map(([value, label]) => (
              <label key={value} className={choiceClass(choices.missingItemPolicy === value)}>
                <input type="radio" name="missing" checked={choices.missingItemPolicy === value} onChange={() => set({ missingItemPolicy: value })} className="size-5 accent-brand-dark" />
                {label}
              </label>
            ))}
          </div>
        </Step>
      )}

      {quote?.requiresAgeCheck && (
        <Step title="Bebida alcoólica">
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" checked={choices.ageConfirmed ?? false} onChange={(event) => set({ ageConfirmed: event.target.checked })} className="mt-1 size-5 shrink-0 accent-brand-dark" />
            <span>Confirmo que tenho 18 anos ou mais. <span className="text-sm text-coffee-soft">Vamos conferir o documento na entrega.</span></span>
          </label>
        </Step>
      )}

      {quote?.payment.collection === "store" ? (
        <Step title="Pagamento">
          <p className="mb-2 text-sm text-coffee-soft">
            Você paga direto para a {quote.store.name}. O Chegô não cobra nada a mais de você.
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {quote.payment.methods.map((method) => (
              <label key={method} className={choiceClass(effectiveMethod === method)}>
                <input type="radio" name="payment" checked={effectiveMethod === method} onChange={() => set({ paymentMethod: method })} className="size-5 accent-brand-dark" />
                {STORE_PAYMENT_LABELS[method]}
              </label>
            ))}
            {effectiveMethod === "pix" && (
              <p className="text-sm text-coffee-soft">A chave Pix da loja aparece no seu pedido assim que ela aceitar.</p>
            )}
            {effectiveMethod === "cash" && (
              <Field
                label="Troco para quanto? (opcional)"
                inputMode="decimal"
                placeholder="Ex.: 50,00"
                value={changeText}
                onChange={(event) => {
                  setChangeText(event.target.value);
                  set({ cashChangeForCents: event.target.value.trim() ? parseMoney(event.target.value) : null });
                }}
                hint="Deixe em branco se não precisar de troco."
              />
            )}
          </div>
        </Step>
      ) : (
      <Step title="Pagamento">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Forma de pagamento">
          <label className={choiceClass(choices.paymentMethod === "pix")}>
            <input type="radio" name="payment" checked={choices.paymentMethod === "pix"} onChange={() => set({ paymentMethod: "pix" })} className="size-5 accent-brand-dark" />
            Pix
          </label>
          {cardEnabled && (
            <label className={choiceClass(choices.paymentMethod === "card")}>
              <input type="radio" name="payment" checked={choices.paymentMethod === "card"} onChange={() => set({ paymentMethod: "card" })} className="size-5 accent-brand-dark" />
              Cartão de crédito
            </label>
          )}
          {choices.paymentMethod === "card" && (
            <div className="flex flex-col gap-3 rounded-2xl bg-cream p-3">
              <p className="text-sm text-coffee-soft">Ambiente de testes: cartão com final 0000 aprova, final 1111 recusa.</p>
              <Field label="Número do cartão" inputMode="numeric" autoComplete="cc-number" maxLength={23} value={card.number} onChange={(event) => setCard({ ...card, number: event.target.value })} />
              <Field label="Nome no cartão" autoComplete="cc-name" maxLength={60} value={card.holder} onChange={(event) => setCard({ ...card, holder: event.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Validade (MM/AA)" autoComplete="cc-exp" maxLength={5} placeholder="12/30" value={card.expiry} onChange={(event) => setCard({ ...card, expiry: event.target.value })} />
                <Field label="Código de segurança" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={card.cvv} onChange={(event) => setCard({ ...card, cvv: event.target.value })} />
              </div>
            </div>
          )}
        </div>
      </Step>
      )}

      <Step title="Resumo">
        {state.status === "error" ? (
          <p role="alert" className="font-semibold text-danger">{state.message}</p>
        ) : !quote ? (
          <div className="h-32 animate-pulse rounded-2xl bg-peach" aria-label="Calculando" />
        ) : (
          <>
            <p className="mb-2 font-semibold">{quote.store.name}</p>
            <ul className="mb-3 text-sm">
              {quote.lines.map((line) => (
                <li key={line.key} className="flex justify-between gap-3 border-b border-cream py-1">
                  <span>
                    {quantityLabel(line.quantity, line.weightStepGrams)} {line.name}
                    {line.lines.map((text) => <span key={text} className="block pl-4 text-coffee-soft">{text}</span>)}
                    {line.notes && <span className="block pl-4 text-coffee-soft">Obs: {line.notes}</span>}
                    {line.error && <span className="block font-bold text-danger">{line.error}</span>}
                  </span>
                  <span className="shrink-0">{formatCents(line.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            {quote.coupon && (
              <p data-testid="coupon-message" className={`mb-2 text-sm font-bold ${quote.coupon.ok ? "text-success" : "text-danger"}`}>
                Cupom {quote.coupon.code}: {quote.coupon.message}
              </p>
            )}
            {quote.warnings.map((warning) => (
              <p key={warning} role="status" className="mb-2 rounded-2xl bg-peach px-3 py-2 text-sm font-semibold">{warning}</p>
            ))}
            <OrderSummary totals={quote.totals} fulfillment={quote.fulfillment} />
          </>
        )}
      </Step>

      {errors.length > 0 && (
        <ul role="alert" data-testid="checkout-errors" className="rounded-2xl bg-peach px-4 py-3 text-sm font-bold text-danger">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}

      <Button type="button" disabled={submitting || !quote || blocked} onClick={submit}>
        {submitting ? "Enviando..." : quote ? `Fazer pedido • ${formatCents(quote.totals.totalCents)}` : "Fazer pedido"}
      </Button>
      <Link href="/carrinho" className="text-center font-semibold text-brand-dark underline">Voltar para a sacola</Link>
    </div>
  );
}
