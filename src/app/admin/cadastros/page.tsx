import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { saveCategory, saveCity, saveNeighborhood, savePlan, saveSubcategory, toggleRegistry } from "../actions";

export const metadata: Metadata = { title: "Cadastros" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const small = "min-h-11 px-3 text-sm";

function Toggle({ id, target, on, labelOn, labelOff, name }: { id: string; target: string; on: boolean; labelOn: string; labelOff: string; name: string }) {
  return (
    <form action={toggleRegistry}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="target" value={target} />
      <Button type="submit" variant={on ? "primary" : "secondary"} className={small} aria-pressed={on} aria-label={`${on ? labelOn : labelOff}: ${name}`}>
        {on ? labelOn : labelOff}
      </Button>
    </form>
  );
}

export default function RegistryPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Registry />
    </Suspense>
  );
}

async function Registry() {
  await requireRole("admin");
  const [cities, hoods, categories, plans, subcategories] = await Promise.all([
    sql<{ id: string; name: string; state: string; order_code_prefix: string; active: boolean; maintenance_mode: boolean; stores: number }[]>`
      select c.id, c.name, c.state, c.order_code_prefix, c.active, c.maintenance_mode,
             (select count(*)::int from stores s where s.city_id = c.id) as stores
      from cities c order by c.name`,
    sql<{ id: string; city_id: string; name: string; is_rural: boolean; active: boolean }[]>`
      select id, city_id, name, is_rural, active from neighborhoods order by is_rural, name`,
    sql<{ id: string; name: string; icon: string; sort_order: number; active: boolean }[]>`
      select id, name, icon, sort_order, active from categories order by sort_order, name`,
    sql<{ id: string; name: string; monthly_price_cents: number; active: boolean; stores: number }[]>`
      select p.id, p.name, p.monthly_price_cents, p.active,
             (select count(*)::int from store_subscriptions s where s.plan_id = p.id) as stores
      from subscription_plans p order by p.monthly_price_cents`,
    sql<{ id: string; category_id: string; name: string; group_name: string | null; active: boolean; stores: number; products: number }[]>`
      select sc.id, sc.category_id, sc.name, sc.group_name, sc.active,
             (select count(*)::int from store_subcategories ss where ss.subcategory_id = sc.id) as stores,
             (select count(*)::int from products p where p.subcategory_id = sc.id and p.deleted_at is null) as products
      from subcategories sc order by sc.sort_order, sc.name`,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">Cadastros</h1>

      <section className={card}>
        <h2 className="text-xl">Cidades</h2>
        <ul className="flex flex-col gap-3">
          {cities.map((city) => (
            <li key={city.id} data-testid="admin-city" className="rounded-2xl bg-cream p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong>{city.name} – {city.state}</strong> · pedidos {city.order_code_prefix}-0001 · {city.stores} loja{city.stores === 1 ? "" : "s"}</span>
                <span className="flex gap-1">
                  <Toggle id={city.id} target="city" on={city.active} labelOn="Ativa" labelOff="Inativa" name={city.name} />
                  <Toggle id={city.id} target="city_maintenance" on={city.maintenance_mode} labelOn="Em manutenção" labelOff="Sem manutenção" name={city.name} />
                </span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {hoods.filter((hood) => hood.city_id === city.id).map((hood) => (
                  <li key={hood.id} className={`flex items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1 ring-1 ring-peach ${hood.active ? "" : "grayscale"}`}>
                    {hood.name}{hood.is_rural && " (rural)"}
                    <form action={toggleRegistry}>
                      <input type="hidden" name="id" value={hood.id} />
                      <input type="hidden" name="target" value="neighborhood" />
                      <button type="submit" className="min-h-11 rounded-full px-2 text-xs font-bold text-brand-dark underline" aria-label={`${hood.active ? "Desativar" : "Reativar"} ${hood.name}`}>
                        {hood.active ? "desativar" : "reativar"}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <ActionForm action={saveNeighborhood} resetOnSuccess className="grid gap-2 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Cidade
            <select name="cityId" required className={inputClass}>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </label>
          <Field label="Novo bairro ou comunidade" name="name" required maxLength={80} />
          <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" name="rural" className="size-5 accent-brand-dark" /> Zona rural</label>
          <SubmitButton variant="secondary" className="min-h-12">Adicionar</SubmitButton>
        </ActionForm>

        <ActionForm action={saveCity} resetOnSuccess className="grid gap-2 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Field label="Nova cidade" name="name" required maxLength={80} />
          <Field label="UF" name="state" required maxLength={2} placeholder="AL" className="uppercase" />
          <Field label="Prefixo dos pedidos" name="prefix" required maxLength={4} placeholder="JG" className="uppercase" />
          <SubmitButton variant="secondary" className="min-h-12">Criar cidade</SubmitButton>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className="text-xl">Categorias</h2>
        <ul className="flex flex-col gap-2">
          {categories.map((category) => (
            <li key={category.id} data-testid="admin-category" className="flex flex-wrap items-end gap-2 rounded-2xl bg-cream p-2">
              <ActionForm action={saveCategory} className="grid flex-1 grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
                <input type="hidden" name="id" value={category.id} />
                <label className="flex flex-col text-xs font-semibold">Nome<input name="name" required defaultValue={category.name} maxLength={60} className={inputClass} /></label>
                <label className="flex flex-col text-xs font-semibold">Ícone<input name="icon" defaultValue={category.icon} maxLength={30} className={inputClass} /></label>
                <label className="flex flex-col text-xs font-semibold">Ordem<input name="order" type="number" min={0} defaultValue={category.sort_order} className={inputClass} /></label>
                <SubmitButton variant="secondary" className={small}>Salvar</SubmitButton>
              </ActionForm>
              <Toggle id={category.id} target="category" on={category.active} labelOn="Ativa" labelOff="Inativa" name={category.name} />
              <details className="w-full" data-testid="admin-subcategories">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">
                  Subcategorias ({subcategories.filter((sub) => sub.category_id === category.id).length})
                </summary>
                <p className="mb-2 text-xs text-coffee-soft">
                  Viram os filtros da categoria no app. Só aparecem para o cliente as que têm loja ou produto. As lojas são marcadas na página de cada loja;
                  os produtos, pela própria loja no cardápio.
                </p>
                <ul className="mb-2 flex flex-wrap gap-2">
                  {subcategories.filter((sub) => sub.category_id === category.id).map((sub) => (
                    <li key={sub.id} className="flex items-center gap-2 rounded-full bg-white py-1 pl-3 pr-1 text-sm ring-1 ring-peach">
                      <span>
                        {sub.name}
                        {sub.group_name && <span className="text-coffee-soft"> · {sub.group_name}</span>}
                        <span className="text-xs text-coffee-soft"> ({sub.stores} lojas, {sub.products} produtos)</span>
                      </span>
                      <Toggle id={sub.id} target="subcategory" on={sub.active} labelOn="Ativa" labelOff="Inativa" name={sub.name} />
                    </li>
                  ))}
                </ul>
                <ActionForm action={saveSubcategory} resetOnSuccess className="grid gap-2 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
                  <input type="hidden" name="categoryId" value={category.id} />
                  <Field label="Nova subcategoria" name="name" required maxLength={60} />
                  <Field label="Grupo (opcional)" name="group" maxLength={60} placeholder="Ex.: Presentes e ocasiões" />
                  <SubmitButton variant="secondary" className="min-h-12">Criar</SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
        <ActionForm action={saveCategory} resetOnSuccess className="grid gap-2 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Field label="Nova categoria" name="name" required maxLength={60} />
          <Field label="Ícone" name="icon" maxLength={30} placeholder="burger" />
          <Field label="Ordem" name="order" type="number" min={0} defaultValue={categories.length} />
          <SubmitButton variant="secondary" className="min-h-12">Criar</SubmitButton>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className="text-xl">Planos de mensalidade</h2>
        <ul className="flex flex-col gap-2">
          {plans.map((plan) => (
            <li key={plan.id} data-testid="admin-plan" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
              <span><strong>{plan.name}</strong> · {formatCents(plan.monthly_price_cents)} por mês · {plan.stores} loja{plan.stores === 1 ? "" : "s"}</span>
              <Toggle id={plan.id} target="plan" on={plan.active} labelOn="Ativo" labelOff="Inativo" name={plan.name} />
            </li>
          ))}
        </ul>
        <ActionForm action={savePlan} resetOnSuccess className="grid gap-2 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <Field label="Novo plano" name="name" required maxLength={60} />
          <Field label="Mensalidade (R$)" name="price" required inputMode="decimal" placeholder="49,90" />
          <SubmitButton variant="secondary" className="min-h-12">Criar plano</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
