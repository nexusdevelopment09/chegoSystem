import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, fileInputClass, inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { saveBanner, saveCoupon, toggleBanner, toggleCoupon } from "../actions";

export const metadata: Metadata = { title: "Marketing" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";

export default function MarketingPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Marketing />
    </Suspense>
  );
}

async function Marketing() {
  await requireRole("admin");
  const at = await now();
  const [banners, coupons, cities, stores, categories, featured] = await Promise.all([
    sql<{ id: string; title: string; image_url: string; link_url: string | null; active: boolean; ends_at: Date | null; city: string | null }[]>`
      select b.id, b.title, b.image_url, b.link_url, b.active, b.ends_at, c.name as city
      from banners b left join cities c on c.id = b.city_id order by b.sort_order`,
    sql<{ id: string; code: string; type: string; value_cents: number | null; percent: string | null; paid_by: string; uses_count: number; max_uses: number | null; expires_at: Date | null; active: boolean; store: string | null }[]>`
      select c.id, c.code, c.type, c.value_cents, c.percent, c.paid_by, c.uses_count, c.max_uses, c.expires_at, c.active,
             (select s.name from stores s where s.id = any(c.store_ids) limit 1) as store
      from coupons c where c.owner_profile_id is null order by c.created_at desc limit 60`,
    sql<{ id: string; name: string }[]>`select id, name from cities order by name`,
    sql<{ id: string; name: string }[]>`select id, name from stores where status in ('active', 'paused') order by name`,
    sql<{ id: string; name: string }[]>`select id, name from categories where active order by sort_order`,
    sql<{ id: string; name: string; featured_until: Date }[]>`
      select id, name, featured_until from stores where featured_until > ${at} order by featured_until`,
  ]);

  const describe = (coupon: (typeof coupons)[number]) =>
    coupon.type === "free_delivery" ? "Frete grátis" : coupon.type === "fixed" ? `${formatCents(coupon.value_cents ?? 0)} de desconto` : `${Number(coupon.percent)}% de desconto`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">Marketing</h1>

      <section className={card}>
        <h2 className="text-xl">Destaques pagos em vigor</h2>
        <p className="text-sm text-coffee-soft">O destaque é marcado na página de cada loja, com data de fim, e aparece identificado para o cliente. Não existe outro jeito de subir uma loja na lista.</p>
        {featured.length === 0 ? <p className="text-sm text-coffee-soft">Nenhuma loja em destaque.</p> : (
          <ul className="text-sm">
            {featured.map((store) => <li key={store.id}><strong>{store.name}</strong> até {formatDateTime(store.featured_until)}</li>)}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-xl">Banners</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {banners.map((banner) => (
            <li key={banner.id} data-testid="admin-banner" className={`flex flex-col gap-2 rounded-2xl bg-cream p-2 ${banner.active ? "" : "grayscale"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={banner.image_url} alt="" width={1200} height={500} loading="lazy" className="aspect-[12/5] w-full rounded-xl object-cover" />
              <p className="text-sm">
                <strong>{banner.title}</strong> · {banner.city ?? "todas as cidades"}
                {banner.ends_at && ` · até ${formatDateTime(banner.ends_at)}`}{banner.link_url && ` · ${banner.link_url}`}
              </p>
              <form action={toggleBanner}>
                <input type="hidden" name="id" value={banner.id} />
                <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">{banner.active ? "Desativar" : "Reativar"}</Button>
              </form>
            </li>
          ))}
        </ul>
        <ActionForm action={saveBanner} resetOnSuccess className="grid gap-3 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-2">
          <Field label="Título do banner" name="title" required maxLength={80} />
          <Field label="Link ao tocar (opcional)" name="link" placeholder="/loja/nome-da-loja" maxLength={200} />
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold sm:col-span-2">
            Imagem (1200 × 500)
            <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required className={fileInputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Cidade
            <select name="cityId" defaultValue="" className={inputClass}>
              <option value="">Todas</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Começa em" name="startsAt" type="date" />
            <Field label="Termina em" name="endsAt" type="date" />
          </div>
          <SubmitButton className="self-start sm:col-span-2">Publicar banner</SubmitButton>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className="text-xl">Cupons</h2>
        <ul className="flex flex-col gap-2">
          {coupons.map((coupon) => (
            <li key={coupon.id} data-testid="admin-coupon" className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2 ${coupon.active ? "" : "grayscale"}`}>
              <span>
                <strong>{coupon.code}</strong> · {describe(coupon)} · pago pela {coupon.paid_by === "platform" ? "plataforma" : "loja"}
                <span className="block text-sm text-coffee-soft">
                  {coupon.uses_count} uso{coupon.uses_count === 1 ? "" : "s"}{coupon.max_uses ? ` de ${coupon.max_uses}` : ""}
                  {coupon.store && ` · só na ${coupon.store}`}{coupon.expires_at && ` · até ${formatDateTime(coupon.expires_at)}`}
                </span>
              </span>
              <form action={toggleCoupon}>
                <input type="hidden" name="id" value={coupon.id} />
                <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">{coupon.active ? "Desativar" : "Reativar"}</Button>
              </form>
            </li>
          ))}
        </ul>
        <ActionForm action={saveCoupon} resetOnSuccess className="grid gap-3 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-2">
          <Field label="Código" name="code" required maxLength={20} className="uppercase" />
          <Field label="Descrição" name="description" maxLength={120} />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Tipo
            <select name="type" defaultValue="fixed" className={inputClass}>
              <option value="fixed">Valor fixo</option><option value="percent">Percentual</option><option value="free_delivery">Frete grátis</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Quem paga o desconto
            <select name="paidBy" defaultValue="platform" className={inputClass}>
              <option value="platform">A plataforma</option><option value="store">A loja (conforme acordo)</option>
            </select>
          </label>
          <Field label="Valor do desconto (R$)" name="value" inputMode="decimal" hint="Para valor fixo." />
          <Field label="Percentual (%)" name="percent" type="number" min={1} max={100} hint="Para percentual." />
          <Field label="Teto do desconto (R$)" name="maxDiscount" inputMode="decimal" />
          <Field label="Pedido mínimo (R$)" name="minOrder" inputMode="decimal" />
          <Field label="Vale até" name="expiresAt" type="date" />
          <Field label="Limite total de usos" name="maxUses" type="number" min={1} />
          <Field label="Usos por cliente" name="maxUsesPerCustomer" type="number" min={1} defaultValue={1} />
          <label className="flex min-h-11 items-center gap-3 self-end"><input type="checkbox" name="firstOrderOnly" className="size-5 accent-brand-dark" /> Só primeira compra no app</label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Só nesta loja
            <select name="storeId" defaultValue="" className={inputClass}>
              <option value="">Qualquer loja</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Só nesta categoria
            <select name="categoryId" defaultValue="" className={inputClass}>
              <option value="">Qualquer categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Só nesta cidade
            <select name="cityId" defaultValue="" className={inputClass}>
              <option value="">Qualquer cidade</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </label>
          <SubmitButton className="self-start sm:col-span-2">Criar cupom</SubmitButton>
        </ActionForm>
        <p className="text-sm text-coffee-soft">Os valores do “Indique e ganhe” ficam em Configurações.</p>
      </section>
    </div>
  );
}
