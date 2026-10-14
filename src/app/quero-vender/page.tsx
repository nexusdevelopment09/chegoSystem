import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountPasswordField } from "@/components/forms/AccountPasswordField";
import { DocumentField } from "@/components/forms/DocumentField";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { getCurrentProfile } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatPhone } from "@/lib/format";
import { listCities } from "@/lib/shopping-context";
import { requestStore } from "./actions";

export const metadata: Metadata = {
  title: "Quero vender no Chegô",
  description: "Cadastre sua loja e venda para a cidade toda pelo Chegô.",
};

export default function SellPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <h1 className="text-3xl">Quero vender no Chegô</h1>
        <p className="mb-4 text-coffee-soft">
          Sua loja no celular de quem mora na cidade. O cliente paga pelo app e você recebe o pedido pronto para preparar.
        </p>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <SellForm />
        </Suspense>
      </main>
    </>
  );
}

async function SellForm() {
  // Lista vinda do banco: monta a cada visita, nunca no build.
  await connection();
  const [profile, cities, categories] = await Promise.all([
    getCurrentProfile(),
    listCities(),
    sql<{ id: string; name: string }[]>`select id, name from categories where active order by sort_order`,
  ]);

  return (
    <ActionForm action={requestStore} className="flex flex-col gap-3 rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
      <h2 className="text-xl">Sobre a loja</h2>
      <Field label="Nome da loja" name="storeName" required maxLength={80} />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        O que a loja vende? (uma frase)
        <textarea name="description" maxLength={300} rows={2} className={`${inputClass} py-3 font-normal`} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Categoria
        <select name="categoryId" required defaultValue="" className={inputClass}>
          <option value="" disabled>Escolha</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Cidade e bairro da loja
        <select name="neighborhoodId" required defaultValue="" className={inputClass}>
          <option value="" disabled>Escolha</option>
          {cities.map((city) => (
            <optgroup key={city.id} label={`${city.name} – ${city.state}`}>
              {city.neighborhoods.map((hood) => <option key={hood.id} value={hood.id}>{hood.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <Field label="Rua" name="street" required maxLength={120} />
        <Field label="Número" name="number" maxLength={20} placeholder="S/N" />
      </div>

      <h2 className="mt-2 text-xl">Sobre você</h2>
      <Field label="Nome do responsável" name="ownerName" required maxLength={80} autoComplete="name" />
      <Field label="Telefone com DDD" name="phone" type="tel" required defaultValue={profile?.phone ? formatPhone(profile.phone) : undefined} placeholder="(82) 90000-0000" hint="É com ele que você vai entrar no painel da loja." />
      <AccountPasswordField signedInAs={profile?.fullName || null} purpose="Você vai entrar no painel com o telefone e esta senha." />
      <DocumentField />

      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="accepted" className="mt-1 size-5 shrink-0 accent-brand-dark" />
        <span>
          Li e aceito os{" "}
          <Link href="/termos/lojista" target="_blank" className="font-bold text-brand-dark underline">Termos do Lojista</Link>.
        </span>
      </label>
      <SubmitButton>Enviar cadastro</SubmitButton>
      <p className="text-sm text-coffee-soft">
        A equipe do Chegô confere os dados antes de a loja aparecer para os clientes. Enquanto isso, você já pode entrar e montar o cardápio.
      </p>
    </ActionForm>
  );
}
