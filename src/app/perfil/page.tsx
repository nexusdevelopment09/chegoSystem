import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/entrar/actions";
import { PushToggle } from "@/components/layout/PushToggle";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { requireUser } from "@/lib/auth/session";
import { sql, withUser } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { listCities } from "@/lib/shopping-context";
import { addAddress, deleteAccount, makeDefaultAddress, removeAddress, signOutEverywhere, updateProfile } from "./actions";

export const metadata: Metadata = { title: "Meu perfil" };

const card = "flex flex-col gap-3 rounded-card bg-white p-5 shadow-sm ring-1 ring-peach";

export default function ProfilePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <ProfileContent />
        </Suspense>
      </main>
    </>
  );
}

async function ProfileContent() {
  const profile = await requireUser();

  const [[details], cities] = await Promise.all([
    sql<{ email: string | null; referral_code: string | null; promo_notifications: boolean }[]>`
      select email, referral_code, promo_notifications from profiles where id = ${profile.id}`,
    listCities(),
  ]);
  // Read as the user: Row Level Security returns only what is theirs.
  const { addresses, coupons } = await withUser(profile.id, async (tx) => ({
    addresses: await tx<{ id: string; street: string; number: string; neighborhood: string; reference: string | null; is_default: boolean }[]>`
      select a.id, a.street, a.number, n.name as neighborhood, a.reference, a.is_default
      from addresses a join neighborhoods n on n.id = a.neighborhood_id
      where a.deleted_at is null order by a.is_default desc, a.created_at desc`,
    coupons: await tx<{ code: string; description: string; value_cents: number | null; expires_at: Date | null; uses_count: number }[]>`
      select code, description, value_cents, expires_at, uses_count from coupons
      where owner_profile_id = ${profile.id} and active and uses_count = 0`,
  }));
  const hoods = (cities.find((city) => city.id === profile.cityId) ?? cities[0])?.neighborhoods ?? [];
  const customer = profile.role === "customer";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Meu perfil</h1>

      {profile.blocked && (
        <p role="status" className="rounded-2xl bg-peach px-4 py-3 font-semibold text-danger">
          Sua conta está bloqueada para novos pedidos. Fale com o suporte.
        </p>
      )}

      <ActionForm action={updateProfile} className={card}>
        <h2 className="text-xl">Meus dados</h2>
        <Field label="Nome completo" name="fullName" required minLength={3} maxLength={80} defaultValue={profile.fullName} autoComplete="name" />
        <div>
          <p className="text-sm font-semibold">Telefone</p>
          <p className="text-lg" data-testid="profile-phone">{profile.phone ? formatPhone(profile.phone) : "Não informado"}</p>
        </div>
        <Field label="E-mail (opcional)" name="email" type="email" defaultValue={details.email ?? ""} autoComplete="email" />
        <Field label="Data de nascimento (opcional)" name="birthDate" type="date" defaultValue={profile.birthDate ?? ""} hint="Usada só para a venda de bebida alcoólica." />
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="promo" defaultChecked={details.promo_notifications} className="size-5 accent-brand-dark" />
          Quero receber promoções e novidades
        </label>
        <p className="-mt-2 text-sm text-coffee-soft">Os avisos do seu pedido chegam sempre, mesmo com as promoções desligadas.</p>
        <SubmitButton className="self-start">Salvar meus dados</SubmitButton>
      </ActionForm>

      <section className={card}>
        <h2 className="text-xl">Notificações</h2>
        <PushToggle />
        <Link href="/notificacoes" className="font-semibold text-brand-dark underline">Ver minhas notificações</Link>
      </section>

      {customer && (
        <>
          <section className={card}>
            <h2 className="text-xl">Endereços</h2>
            {addresses.length === 0 && <p className="text-sm text-coffee-soft">Nenhum endereço salvo.</p>}
            <ul className="flex flex-col gap-2">
              {addresses.map((address) => (
                <li key={address.id} data-testid="profile-address" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
                  <span>
                    <strong>{address.street}, {address.number}</strong> · {address.neighborhood}
                    {address.is_default && <span className="ml-2 rounded-full bg-peach px-2 text-xs font-bold">Principal</span>}
                    {address.reference && <span className="block text-sm text-coffee-soft">Referência: {address.reference}</span>}
                  </span>
                  <span className="flex gap-1">
                    {!address.is_default && (
                      <form action={makeDefaultAddress}>
                        <input type="hidden" name="id" value={address.id} />
                        <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm">Tornar principal</Button>
                      </form>
                    )}
                    <form action={removeAddress}>
                      <input type="hidden" name="id" value={address.id} />
                      <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm" aria-label={`Remover o endereço ${address.street}, ${address.number}`}>Remover</Button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
            <details>
              <summary className="min-h-11 cursor-pointer font-bold text-brand-dark underline">Adicionar endereço</summary>
              <ActionForm action={addAddress} resetOnSuccess className="mt-2 flex flex-col gap-3">
                <Field label="Rua" name="street" required maxLength={120} />
                <Field label="Número" name="number" maxLength={20} placeholder="S/N" />
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Bairro ou comunidade
                  <select name="neighborhoodId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>Escolha</option>
                    {hoods.map((hood) => <option key={hood.id} value={hood.id}>{hood.name}{hood.isRural ? " (zona rural)" : ""}</option>)}
                  </select>
                </label>
                <Field label="Ponto de referência" name="reference" maxLength={200} hint="Obrigatório na zona rural." />
                <Field label="Complemento" name="complement" maxLength={100} />
                <SubmitButton variant="secondary" className="self-start">Salvar endereço</SubmitButton>
              </ActionForm>
            </details>
          </section>

          <section className={card}>
            <h2 className="text-xl">Indique e ganhe</h2>
            <p>
              Seu código: <strong className="font-display text-2xl" data-testid="referral-code">{details.referral_code ?? "—"}</strong>
            </p>
            <p className="text-sm text-coffee-soft">
              Quem usar seu código na primeira compra ganha desconto. Quando o pedido da pessoa for entregue, você ganha um cupom também.
            </p>
          </section>

          <section className={card}>
            <h2 className="text-xl">Meus cupons</h2>
            {coupons.length === 0 ? <p className="text-sm text-coffee-soft">Você não tem cupons pessoais agora.</p> : (
              <ul className="flex flex-col gap-2">
                {coupons.map((coupon) => (
                  <li key={coupon.code} className="rounded-2xl bg-cream px-3 py-2">
                    <strong>{coupon.code}</strong> · {coupon.value_cents ? `${formatCents(coupon.value_cents)} de desconto` : coupon.description}
                    {coupon.expires_at && <span className="block text-sm text-coffee-soft">Vale até {formatDateTime(coupon.expires_at)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className={card}>
        <h2 className="text-xl">Privacidade</h2>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/termos/uso" className="font-semibold text-brand-dark underline">Termos de Uso</Link>
          <Link href="/termos/privacidade" className="font-semibold text-brand-dark underline">Política de Privacidade</Link>
          <Link href="/ajuda" className="font-semibold text-brand-dark underline">Ajuda</Link>
        </p>
        <a href="/perfil/meus-dados" download className={buttonClass("secondary", "self-start")}>Baixar meus dados</a>

        <details>
          <summary className="min-h-11 cursor-pointer font-bold text-danger underline">Excluir minha conta</summary>
          <ActionForm action={deleteAccount} className="mt-2 flex flex-col gap-3">
            <p className="text-sm">
              Seus dados pessoais são apagados e você sai do app. Os pedidos já feitos ficam guardados sem o seu nome, porque as lojas precisam deles para a contabilidade. Isso não dá para desfazer.
            </p>
            <Field label="Para confirmar, escreva EXCLUIR" name="confirm" required autoComplete="off" />
            <SubmitButton variant="secondary" className="self-start text-danger">Excluir minha conta para sempre</SubmitButton>
          </ActionForm>
        </details>
      </section>

      <section className="flex flex-col gap-2">
        <form action={signOut}>
          <Button type="submit" className="w-full">Sair</Button>
        </form>
        <form action={signOutEverywhere}>
          <Button type="submit" variant="secondary" className="w-full">Sair de todos os aparelhos</Button>
        </form>
      </section>
    </div>
  );
}
