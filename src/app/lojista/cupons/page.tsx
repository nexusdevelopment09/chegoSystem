import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { withUser } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { createStoreCoupon, toggleStoreCoupon } from "../owner-actions";

export const metadata: Metadata = { title: "Cupons da loja" };

export default function StoreCouponsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Coupons />
    </Suspense>
  );
}

type CouponRow = {
  id: string; code: string; type: "fixed" | "percent" | "free_delivery"; value_cents: number | null; percent: string | null;
  max_discount_cents: number | null; min_order_cents: number; uses_count: number; max_uses: number | null;
  expires_at: Date | null; active: boolean;
};

function describe(coupon: CouponRow): string {
  if (coupon.type === "free_delivery") return "Frete grátis";
  if (coupon.type === "fixed") return `${formatCents(coupon.value_cents ?? 0)} de desconto`;
  return `${Number(coupon.percent)}% de desconto${coupon.max_discount_cents ? `, até ${formatCents(coupon.max_discount_cents)}` : ""}`;
}

async function Coupons() {
  const { profile, store } = await getMerchantContext(["owner"]);
  // Como dono da loja: as regras de acesso por linha (RLS) devolvem só os cupons desta loja.
  const coupons = await withUser(profile.id, (tx) => tx<CouponRow[]>`
    select id, code, type, value_cents, percent, max_discount_cents, min_order_cents, uses_count, max_uses, expires_at, active
    from coupons where created_by_store_id = ${store.id} order by created_at desc`);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl">Cupons da loja</h1>
      <p className="text-coffee-soft">O desconto dos cupons criados aqui é pago pela loja e só vale na sua loja.</p>

      {coupons.length === 0 && <p className="rounded-card bg-white p-6 text-center text-coffee-soft ring-1 ring-peach">Nenhum cupom criado ainda.</p>}
      <ul className="flex flex-col gap-2">
        {coupons.map((coupon) => (
          <li key={coupon.id} data-testid="store-coupon" className={`flex flex-wrap items-center justify-between gap-2 rounded-card bg-white p-4 ring-1 ring-peach ${coupon.active ? "" : "grayscale"}`}>
            <div>
              <p className="font-display text-xl font-semibold">{coupon.code}</p>
              <p className="text-sm">{describe(coupon)}{coupon.min_order_cents > 0 && ` · mínimo ${formatCents(coupon.min_order_cents)}`}</p>
              <p className="text-sm text-coffee-soft">
                Usado {coupon.uses_count}{coupon.max_uses ? ` de ${coupon.max_uses}` : ""} vez{coupon.uses_count === 1 ? "" : "es"}
                {coupon.expires_at && ` · vale até ${formatDateTime(coupon.expires_at)}`}
              </p>
            </div>
            <form action={toggleStoreCoupon}>
              <input type="hidden" name="id" value={coupon.id} />
              <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">{coupon.active ? "Desativar" : "Reativar"}</Button>
            </form>
          </li>
        ))}
      </ul>

      <ActionForm action={createStoreCoupon} resetOnSuccess className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="text-xl">Novo cupom</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código" name="code" required maxLength={20} placeholder="PIZZA10" className="uppercase" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Tipo
            <select name="type" defaultValue="percent" className={inputClass}>
              <option value="percent">Percentual</option>
              <option value="fixed">Valor fixo</option>
              <option value="free_delivery">Frete grátis</option>
            </select>
          </label>
          <Field label="Percentual (%)" name="percent" type="number" min={1} max={100} hint="Para cupom percentual." />
          <Field label="Teto do desconto (R$)" name="maxDiscount" inputMode="decimal" hint="Para cupom percentual. Opcional." />
          <Field label="Valor do desconto (R$)" name="value" inputMode="decimal" hint="Para cupom de valor fixo." />
          <Field label="Pedido mínimo (R$)" name="minOrder" inputMode="decimal" />
          <Field label="Vale até" name="expiresAt" type="date" />
          <Field label="Limite total de usos" name="maxUses" type="number" min={1} />
          <Field label="Usos por cliente" name="maxUsesPerCustomer" type="number" min={1} defaultValue={1} />
        </div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="firstOrderOnly" className="size-5 accent-brand-dark" /> Só para a primeira compra no app</label>
        <SubmitButton className="self-start">Criar cupom</SubmitButton>
      </ActionForm>
    </div>
  );
}
