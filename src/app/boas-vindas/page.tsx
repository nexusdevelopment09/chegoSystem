import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoIcon } from "@/components/brand/LogoIcon";
import { InstallButton } from "@/components/layout/InstallButton";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { getShoppingContext, listCities } from "@/lib/shopping-context";
import { chooseLocation } from "./actions";

export const metadata: Metadata = { title: "Boas-vindas" };

// First visit (and "trocar endereço"): where are you ordering from?
export default function WelcomePage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10 text-center">
      <div className="self-center">
        <LogoIcon size={96} title="Chegô" />
      </div>
      <div>
        <h1 className="text-3xl">Pediu, Chegô.</h1>
        <p className="text-coffee-soft">Tudo da cidade, numa sacola só.</p>
      </div>
      <Suspense fallback={<div className="h-56 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
        <LocationForm />
      </Suspense>
      <InstallButton />
    </main>
  );
}

async function LocationForm() {
  const [cities, context] = await Promise.all([listCities(), getShoppingContext()]);
  const city = cities.find((item) => item.id === context.city?.id) ?? cities[0];
  if (!city) return <p className="text-coffee-soft">Nenhuma cidade disponível ainda.</p>;

  return (
    <form action={chooseLocation} className="flex flex-col gap-4 rounded-card bg-white p-6 text-left shadow-sm ring-1 ring-peach">
      {cities.length === 1 ? (
        <>
          <input type="hidden" name="cityId" value={city.id} />
          <p>
            Você está em <strong>{city.name} – {city.state}</strong>
          </p>
        </>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Sua cidade
          <select name="cityId" defaultValue={city.id} className={inputClass}>
            {cities.map((item) => (
              <option key={item.id} value={item.id}>{item.name} – {item.state}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Seu bairro ou comunidade
        <select name="neighborhoodId" defaultValue={context.neighborhood?.id ?? ""} className={inputClass}>
          <option value="">Escolher depois</option>
          <optgroup label="Bairros">
            {city.neighborhoods.filter((hood) => !hood.isRural).map((hood) => (
              <option key={hood.id} value={hood.id}>{hood.name}</option>
            ))}
          </optgroup>
          <optgroup label="Comunidades rurais">
            {city.neighborhoods.filter((hood) => hood.isRural).map((hood) => (
              <option key={hood.id} value={hood.id}>{hood.name}</option>
            ))}
          </optgroup>
        </select>
        <span className="font-normal text-coffee-soft">Assim a gente mostra a taxa e o tempo de entrega certos.</span>
      </label>

      <Button type="submit">Ver as lojas</Button>
    </form>
  );
}
