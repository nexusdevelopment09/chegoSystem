import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { withUser } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { deleteGroup, deleteOption, saveGroup, saveOption, toggleOption } from "../actions";

export const metadata: Metadata = { title: "Grupos de opções" };

const small = "min-h-11 px-3 text-sm";

export default function GroupsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Groups />
    </Suspense>
  );
}

async function Groups() {
  const { profile, store } = await getMerchantContext(["owner", "attendant"]);
  const { groups, options } = await withUser(profile.id, async (tx) => ({
    groups: await tx<{ id: string; name: string; products: number }[]>`
      select g.id, g.name, (select count(*)::int from product_option_groups l where l.group_id = g.id) as products
      from option_groups g where g.store_id = ${store.id} order by g.name`,
    options: await tx<{ id: string; group_id: string; name: string; category_label: string | null; default_price_cents: number; available: boolean }[]>`
      select o.id, o.group_id, o.name, o.category_label, o.default_price_cents, o.available
      from options o join option_groups g on g.id = o.group_id
      where g.store_id = ${store.id} order by o.sort_order`,
  }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/lojista/cardapio" className="font-semibold text-brand-dark underline">← Cardápio</Link>
      <h1 className="text-3xl">Grupos de opções</h1>
      <p className="text-coffee-soft">
        Um grupo (Sabores, Bordas, Adicionais...) é criado uma vez e pode ser ligado a vários produtos, com preço diferente em cada um.
      </p>

      {groups.map((group) => (
        <section key={group.id} data-testid="option-group" className="rounded-card bg-white p-4 ring-1 ring-peach">
          <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">{group.name} <span className="font-sans text-sm font-normal text-coffee-soft">em {group.products} produto{group.products === 1 ? "" : "s"}</span></h2>
            <form action={deleteGroup}>
              <input type="hidden" name="id" value={group.id} />
              <Button type="submit" variant="secondary" className={small}>Excluir grupo</Button>
            </form>
          </header>

          <ul className="mb-3 flex flex-col">
            {options.filter((option) => option.group_id === group.id).map((option) => (
              <li key={option.id} data-testid="option-row" className="flex flex-wrap items-center justify-between gap-2 border-b border-cream py-1">
                <span className={option.available ? "" : "text-coffee-soft line-through"}>
                  {option.name}
                  {option.category_label && <span className="ml-2 text-sm text-coffee-soft no-underline">({option.category_label})</span>}
                  <span className="ml-2 text-sm text-coffee-soft">{formatCents(option.default_price_cents)}</span>
                </span>
                <span className="flex gap-1">
                  <form action={toggleOption}>
                    <input type="hidden" name="id" value={option.id} />
                    <Button type="submit" variant={option.available ? "secondary" : "primary"} className={small}
                      aria-label={option.available ? `Marcar ${option.name} como esgotado` : `Voltar a oferecer ${option.name}`}>
                      {option.available ? "Esgotar" : "Reativar"}
                    </Button>
                  </form>
                  <form action={deleteOption}>
                    <input type="hidden" name="id" value={option.id} />
                    <Button type="submit" variant="secondary" className={small} aria-label={`Excluir a opção ${option.name}`}>Excluir</Button>
                  </form>
                </span>
              </li>
            ))}
          </ul>

          <ActionForm action={saveOption} resetOnSuccess className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="groupId" value={group.id} />
            <label className="flex flex-col gap-1 text-sm font-semibold">Nova opção<input name="name" required maxLength={80} className={inputClass} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Subtítulo<input name="label" maxLength={40} placeholder="Tradicionais" className={inputClass} /></label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Preço padrão<input name="price" inputMode="decimal" placeholder="0,00" className={inputClass} /></label>
            <SubmitButton variant="secondary" className={small}>Adicionar</SubmitButton>
          </ActionForm>
        </section>
      ))}

      <ActionForm action={saveGroup} resetOnSuccess className="flex flex-wrap items-end gap-2 rounded-card bg-white p-4 ring-1 ring-peach">
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
          Novo grupo
          <input name="name" required maxLength={60} placeholder="Ex.: Adicionais" className={inputClass} />
        </label>
        <SubmitButton className={small}>Criar grupo</SubmitButton>
      </ActionForm>
    </div>
  );
}
