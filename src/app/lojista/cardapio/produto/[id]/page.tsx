import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ProductImage } from "@/components/catalog/ProductImage";
import { ImageInput } from "@/components/forms/ImageInput";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { withUser } from "@/lib/db";
import { getMerchantContext } from "@/lib/merchant/context";
import { WEEKDAY_NAMES } from "@/lib/time";
import { deleteProduct, duplicateProduct, linkGroup, saveOptionPrices, saveProduct, unlinkGroup } from "../../actions";
import { formatWeight, WEIGHT_STEPS } from "@/lib/catalog/weight";

export const metadata: Metadata = { title: "Produto" };

const MODE_LABELS = {
  sum: "Soma o preço de cada opção (adicionais)",
  highest: "Cobra a opção mais cara (pizza meio a meio)",
  average: "Cobra a média das opções",
  free_up_to: "As primeiras são grátis, as seguintes pagam",
};

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const check = "size-5 shrink-0 accent-brand-dark";

type Params = Promise<{ id: string }>;

export default function ProductEditPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <ProductEditor params={params} />
    </Suspense>
  );
}

type ProductRow = {
  id: string; section_id: string | null; name: string; description: string; price_cents: number; image_url: string | null;
  available: boolean; featured: boolean; min_lead_minutes: number; max_per_order: number | null; track_stock: boolean;
  stock_qty: number | null; requires_age_check: boolean;
  weight_step_grams: number | null; price_per_kg_cents: number | null; weight_min_grams: number | null;
};
type LinkRow = { group_id: string; name: string; min_choices: number; max_choices: number; allow_repeat: boolean; price_mode: keyof typeof MODE_LABELS; free_quantity: number };
type OptionRow = { id: string; group_id: string; name: string; default_price_cents: number; price_cents: number | null };

async function ProductEditor({ params }: { params: Params }) {
  const { id } = await params;
  const isNew = id === "novo";
  if (!isNew && !z.uuid().safeParse(id).success) notFound();

  const { profile, store } = await getMerchantContext(["owner", "attendant"]);
  const data = await withUser(profile.id, async (tx) => {
    const sections = await tx<{ id: string; name: string }[]>`select id, name from product_sections where store_id = ${store.id} order by sort_order`;
    const groups = await tx<{ id: string; name: string }[]>`select id, name from option_groups where store_id = ${store.id} order by name`;
    if (isNew) return { sections, groups, product: null, windows: [], links: [], options: [] };

    const [product] = await tx<ProductRow[]>`
      select id, section_id, name, description, price_cents, image_url, available, featured, min_lead_minutes,
             max_per_order, track_stock, stock_qty, requires_age_check, weight_step_grams, price_per_kg_cents, weight_min_grams
      from products where id = ${id} and store_id = ${store.id} and deleted_at is null`;
    if (!product) return null;
    return {
      sections, groups, product,
      windows: await tx<{ weekday: number; starts_at: string; ends_at: string }[]>`
        select weekday, starts_at::text, ends_at::text from product_availability where product_id = ${id}`,
      links: await tx<LinkRow[]>`
        select pog.group_id, g.name, pog.min_choices, pog.max_choices, pog.allow_repeat, pog.price_mode, pog.free_quantity
        from product_option_groups pog join option_groups g on g.id = pog.group_id
        where pog.product_id = ${id} order by pog.sort_order`,
      options: await tx<OptionRow[]>`
        select o.id, o.group_id, o.name, o.default_price_cents, pop.price_cents
        from product_option_groups pog
        join options o on o.group_id = pog.group_id
        left join product_option_prices pop on pop.product_id = pog.product_id and pop.option_id = o.id
        where pog.product_id = ${id} order by o.sort_order`,
    };
  });
  if (!data) notFound();

  const { product, sections, groups, windows, links, options } = data;
  const days = new Set(windows.map((window) => window.weekday));
  const from = windows[0]?.starts_at.slice(0, 5) ?? "";
  const to = windows[0]?.ends_at.slice(0, 5) ?? "";
  const linked = new Set(links.map((link) => link.group_id));
  // Vendido por peso: porção em gramas (null = por unidade).
  const step = product?.weight_step_grams ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/lojista/cardapio" className="font-semibold text-brand-dark underline">← Cardápio</Link>
      <h1 className="text-3xl">{product ? product.name : "Novo produto"}</h1>

      {store.categorySlug === "farmacia" && (
        <p role="note" className="rounded-2xl bg-danger px-4 py-3 font-bold text-white">Proibido cadastrar medicamentos que exigem receita.</p>
      )}
      {store.categorySlug === "saudavel" && (
        <p role="note" className="rounded-2xl bg-peach px-4 py-3 font-bold">Não prometa cura ou resultados de saúde na descrição.</p>
      )}

      <ActionForm action={saveProduct} className="flex flex-col gap-4 rounded-card bg-white p-4 ring-1 ring-peach">
        {product && <input type="hidden" name="id" value={product.id} />}
        <Field label="Nome" name="name" required maxLength={120} defaultValue={product?.name} />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Descrição
          <textarea name="description" maxLength={500} rows={3} defaultValue={product?.description} className={`${inputClass} py-3 font-normal`} />
        </label>
        <fieldset className="flex flex-col gap-2 rounded-2xl bg-cream p-3">
          <legend className="text-sm font-semibold">Como vende</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name="saleUnit" value="unit" defaultChecked={!step} className={check} /> Por unidade
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name="saleUnit" value="weight" defaultChecked={Boolean(step)} className={check} /> Por peso (o cliente escolhe os gramas)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Por peso: precisão
              <select name="weightStep" defaultValue={String(step ?? 10)} className={inputClass}>
                {WEIGHT_STEPS.map((grams) => <option key={grams} value={grams}>de {formatWeight(grams)} em {formatWeight(grams)}</option>)}
              </select>
            </label>
            <Field label="Por peso: pedido mínimo (g)" name="weightMin" type="number" min={1}
              defaultValue={product?.weight_min_grams ?? 100} />
          </div>
          <p className="text-sm text-coffee-soft">
            Por peso, o <strong>preço é o do quilo</strong> e o <strong>estoque e o máximo por pedido são em gramas</strong>.
            O cliente digita quantos gramas quer (por exemplo 110 g, com precisão de 10 g) e paga pelo preço do quilo.
          </p>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label={step ? "Preço do kg (R$)" : "Preço (R$)"} name="price" required inputMode="decimal"
            defaultValue={product ? money(product.price_per_kg_cents ?? product.price_cents) : ""}
            hint="Por peso: o preço do quilo. Use 0,00 quando o preço vem das opções (pizza)." />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Seção
            <select name="sectionId" defaultValue={product?.section_id ?? ""} className={inputClass}>
              <option value="">Sem seção</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <ProductImage url={product?.image_url ?? null} alt="" size={72} className="size-[72px] rounded-2xl" />
          <ImageInput name="image" label="Foto do produto" className="flex-1" maxSide={1200} />
        </div>
        {product?.image_url && (
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="removeImage" className={check} /> Remover a foto</label>
        )}

        <fieldset className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="available" defaultChecked={product?.available ?? true} className={check} /> Disponível para venda</label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="featured" defaultChecked={product?.featured} className={check} /> Destaque da loja</label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="requiresAgeCheck" defaultChecked={product?.requires_age_check} className={check} /> Bebida alcoólica (só para maiores de 18)</label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="trackStock" defaultChecked={product?.track_stock} className={check} /> Controlar estoque (esgota sozinho ao zerar)</label>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <Field label={step ? "Estoque (g)" : "Estoque"} name="stockQty" type="number" min={0}
            defaultValue={product?.stock_qty == null ? "" : product.stock_qty * (step ?? 1)} />
          <Field label={step ? "Máx. por pedido (g)" : "Máx. por pedido"} name="maxPerOrder" type="number" min={1}
            defaultValue={product?.max_per_order == null ? "" : product.max_per_order * (step ?? 1)} />
          <Field label="Antecedência (horas)" name="minLeadHours" type="number" min={0} defaultValue={product ? product.min_lead_minutes / 60 : 0} />
        </div>

        <fieldset className="rounded-2xl bg-cream p-3">
          <legend className="text-sm font-semibold">Dias e horários em que pode ser pedido</legend>
          <p className="mb-2 text-sm text-coffee-soft">Sem nenhum dia marcado, vale todos os dias. Sem horário, vale o dia todo.</p>
          <div className="flex flex-wrap gap-x-4">
            {WEEKDAY_NAMES.map((name, weekday) => (
              <label key={name} className="flex min-h-11 items-center gap-2 capitalize">
                <input type="checkbox" name="weekdays" value={weekday} defaultChecked={days.size < 7 && days.has(weekday)} className={check} /> {name}
              </label>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Das" name="windowFrom" type="time" defaultValue={from === "00:00" ? "" : from} />
            <Field label="Até" name="windowTo" type="time" defaultValue={to === "23:59" ? "" : to} />
          </div>
        </fieldset>

        <SubmitButton>{product ? "Salvar produto" : "Criar produto"}</SubmitButton>
      </ActionForm>

      {product && (
        <>
          <section className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
            <h2 className="text-xl">Opções deste produto</h2>
            {links.length === 0 && <p className="text-sm text-coffee-soft">Nenhum grupo ligado. Ligue um grupo abaixo (sabores, bordas, adicionais...).</p>}

            {links.map((link) => (
              <div key={link.group_id} data-testid="linked-group" className="rounded-2xl bg-cream p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{link.name}</p>
                    <p className="text-sm text-coffee-soft">
                      {link.min_choices > 0 ? `Obrigatório, de ${link.min_choices} a ${link.max_choices}` : `Opcional, até ${link.max_choices}`}
                      {link.allow_repeat && " · pode repetir"} · {MODE_LABELS[link.price_mode]}
                      {link.price_mode === "free_up_to" && ` (${link.free_quantity} grátis)`}
                    </p>
                  </div>
                  <form action={unlinkGroup}>
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="groupId" value={link.group_id} />
                    <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm">Desligar</Button>
                  </form>
                </div>

                <ActionForm action={saveOptionPrices} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="productId" value={product.id} />
                  <p className="text-sm text-coffee-soft">Preço de cada opção neste produto. Em branco, vale o preço padrão da opção.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {options.filter((option) => option.group_id === link.group_id).map((option) => (
                      <label key={option.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{option.name}</span>
                        <input name={`price:${option.id}`} inputMode="decimal" aria-label={`Preço de ${option.name} neste produto`}
                          defaultValue={option.price_cents === null ? "" : money(option.price_cents)} placeholder={money(option.default_price_cents)}
                          className={`${inputClass} w-28 text-right`} />
                      </label>
                    ))}
                  </div>
                  <SubmitButton variant="secondary" className="min-h-11 self-start px-4 text-sm">Salvar preços</SubmitButton>
                </ActionForm>
              </div>
            ))}

            <ActionForm action={linkGroup} className="grid gap-3 rounded-2xl border-2 border-dashed border-peach p-3 sm:grid-cols-2">
              <input type="hidden" name="productId" value={product.id} />
              <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
                Ligar grupo de opções
                <select name="groupId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>Escolha um grupo</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}{linked.has(group.id) ? " (já ligado: altera as regras)" : ""}</option>)}
                </select>
              </label>
              <Field label="Mínimo de escolhas" name="min" type="number" min={0} max={20} defaultValue={0} hint="0 = opcional" />
              <Field label="Máximo de escolhas" name="max" type="number" min={1} max={20} defaultValue={1} />
              <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
                Como o preço é calculado
                <select name="mode" defaultValue="sum" className={inputClass}>
                  {Object.entries(MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Field label="Quantas grátis" name="free" type="number" min={0} max={20} defaultValue={0} hint="Só para “as primeiras são grátis”." />
              <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="repeat" className={check} /> Pode repetir a mesma opção</label>
              <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm sm:col-span-2">Ligar grupo</SubmitButton>
            </ActionForm>
            <Link href="/lojista/cardapio/grupos" className="text-sm font-semibold text-brand-dark underline">Criar ou editar grupos de opções</Link>
          </section>

          <section className="flex flex-wrap gap-2">
            <form action={duplicateProduct}>
              <input type="hidden" name="id" value={product.id} />
              <Button type="submit" variant="secondary">Duplicar produto</Button>
            </form>
            <form action={deleteProduct}>
              <input type="hidden" name="id" value={product.id} />
              <Button type="submit" variant="secondary" className="text-danger">Excluir produto</Button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
