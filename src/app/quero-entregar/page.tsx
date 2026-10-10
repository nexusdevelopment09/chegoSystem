import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DocumentField } from "@/components/forms/DocumentField";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { VEHICLE_LABELS } from "@/lib/labels";
import { listCities } from "@/lib/shopping-context";
import { requestCourier } from "./actions";

export const metadata: Metadata = {
  title: "Quero entregar pelo Chegô",
  description: "Cadastre-se como entregador parceiro do Chegô e ganhe por entrega.",
};

export default function DeliverPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <h1 className="text-3xl">Quero entregar pelo Chegô</h1>
        <p className="mb-4 text-coffee-soft">
          Faça entregas das lojas da cidade quando quiser. Você vê quanto ganha antes de aceitar cada entrega.
        </p>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
          <DeliverForm />
        </Suspense>
      </main>
    </>
  );
}

async function DeliverForm() {
  const cities = await listCities();

  return (
    <ActionForm action={requestCourier} className="flex flex-col gap-3 rounded-card bg-white p-5 shadow-sm ring-1 ring-peach">
      <Field label="Seu nome completo" name="fullName" required maxLength={80} autoComplete="name" />
      <Field label="Telefone com DDD" name="phone" type="tel" required placeholder="(82) 90000-0000" hint="É com ele que você vai entrar para ver as entregas." />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Cidade onde você entrega
        <select name="cityId" required defaultValue={cities.length === 1 ? cities[0].id : ""} className={inputClass}>
          <option value="" disabled>Escolha</option>
          {cities.map((city) => <option key={city.id} value={city.id}>{city.name} – {city.state}</option>)}
        </select>
      </label>

      <DocumentField />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Como você faz as entregas
          <select name="vehicle" required defaultValue="motorcycle" className={inputClass}>
            {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Field label="Placa do veículo" name="plate" maxLength={8} placeholder="ABC1D23" className="uppercase" hint="Só para moto e carro." />
      </div>

      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="accepted" className="mt-1 size-5 shrink-0 accent-brand-dark" />
        <span>
          Li e aceito os{" "}
          <Link href="/termos/uso" target="_blank" className="font-bold text-brand-dark underline">Termos de Uso</Link> e a{" "}
          <Link href="/termos/privacidade" target="_blank" className="font-bold text-brand-dark underline">Política de Privacidade</Link>.
        </span>
      </label>
      <SubmitButton>Enviar cadastro</SubmitButton>
      <p className="text-sm text-coffee-soft">A equipe do Chegô confere os dados antes de liberar as entregas.</p>
    </ActionForm>
  );
}
