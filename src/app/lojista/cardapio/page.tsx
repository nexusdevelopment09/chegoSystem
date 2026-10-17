import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProductImage } from "@/components/catalog/ProductImage";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button, buttonClass } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { withUser } from "@/lib/db";
import { formatWeight } from "@/lib/catalog/weight";
import { formatCents } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { deleteSection, moveSection, saveSection, toggleProduct } from "./actions";

export const metadata: Metadata = { title: "Cardápio" };

const small = "min-h-11 px-4 text-sm";

export default function MenuPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Menu />
    </Suspense>
  );
}

type ProductRow = {
  id: string; section_id: string | null; name: string; price_cents: number; image_url: string | null;
  available: boolean; track_stock: boolean; stock_qty: number | null; groups: number;
  weight_step_grams: number | null; price_per_kg_cents: number | null;
};

async function Menu() {
  const { profile, store } = await getMerchantContext(["owner", "attendant"]);

  const { sections, products } = await withUser(profile.id, async (tx) => ({
    sections: await tx<{ id: string; name: string }[]>`
      select id, name from product_sections where store_id = ${store.id} order by sort_order, name`,
    products: await tx<ProductRow[]>`
      select p.id, p.section_id, p.name, p.price_cents, p.image_url, p.available, p.track_stock, p.stock_qty,
             p.weight_step_grams, p.price_per_kg_cents,
             (select count(*)::int from product_option_groups g where g.product_id = p.id) as groups
      from products p
      where p.store_id = ${store.id} and p.deleted_at is null
      order by p.sort_order, p.name`,
  }));

  const groups = [...sections, { id: "", name: "Sem seção" }]
    .map((section) => ({ section, items: products.filter((product) => (product.section_id ?? "") === section.id) }))
    .filter((group) => group.section.id !== "" || group.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl">Cardápio</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/lojista/cardapio/produto/novo" className={buttonClass("primary", small)}>Novo produto</Link>
          <Link href="/lojista/cardapio/grupos" className={buttonClass("secondary", small)}>Grupos de opções</Link>
          <Link href="/lojista/cardapio/planilha" className={buttonClass("secondary", small)}>Planilha e reajuste</Link>
        </div>
      </header>

      {store.categorySlug === "farmacia" && (
        <p role="note" className="rounded-2xl bg-danger px-4 py-3 font-bold text-white">Proibido cadastrar medicamentos que exigem receita.</p>
      )}
      {store.categorySlug === "saudavel" && (
        <p role="note" className="rounded-2xl bg-peach px-4 py-3 font-bold">Não prometa cura ou resultados de saúde na descrição.</p>
      )}

      {groups.map(({ section, items }, index) => (
        <section key={section.id || "none"} data-testid="menu-section" className="rounded-card bg-white p-4 ring-1 ring-peach">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">{section.name} <span className="font-sans text-sm font-normal text-coffee-soft">({items.length})</span></h2>
            {section.id && (
              <div className="flex gap-1">
                <form action={moveSection}>
                  <input type="hidden" name="id" value={section.id} />
                  <input type="hidden" name="direction" value="up" />
                  <Button type="submit" variant="secondary" className="min-h-11 px-3" aria-label={`Subir a seção ${section.name}`} disabled={index === 0}>↑</Button>
                </form>
                <form action={moveSection}>
                  <input type="hidden" name="id" value={section.id} />
                  <input type="hidden" name="direction" value="down" />
                  <Button type="submit" variant="secondary" className="min-h-11 px-3" aria-label={`Descer a seção ${section.name}`} disabled={index >= sections.length - 1}>↓</Button>
                </form>
                <form action={deleteSection}>
                  <input type="hidden" name="id" value={section.id} />
                  <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm" aria-label={`Excluir a seção ${section.name}`}>Excluir</Button>
                </form>
              </div>
            )}
          </header>

          <ul className="flex flex-col gap-2">
            {items.map((product) => {
              const soldOut = !product.available || (product.track_stock && (product.stock_qty ?? 0) <= 0);
              return (
                <li key={product.id} data-testid="menu-row" className="flex flex-wrap items-center gap-3 rounded-2xl bg-cream p-2">
                  <ProductImage url={product.image_url} alt="" size={56} className="size-14 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/lojista/cardapio/produto/${product.id}`} className="font-semibold text-brand-dark underline">{product.name}</Link>
                    <p className="text-sm text-coffee-soft">
                      {product.price_per_kg_cents ? `${formatCents(product.price_per_kg_cents)}/kg` : formatCents(product.price_cents)}
                      {product.groups > 0 && ` · ${product.groups} grupo${product.groups > 1 ? "s" : ""} de opções`}
                      {product.track_stock && ` · estoque ${product.weight_step_grams ? formatWeight((product.stock_qty ?? 0) * product.weight_step_grams) : product.stock_qty ?? 0}`}
                    </p>
                  </div>
                  <form action={toggleProduct}>
                    <input type="hidden" name="id" value={product.id} />
                    <Button type="submit" variant={soldOut ? "primary" : "secondary"} className={small} aria-pressed={!product.available}
                      aria-label={product.available ? `Marcar ${product.name} como esgotado` : `Voltar a vender ${product.name}`}>
                      {product.available ? "Marcar esgotado" : "Esgotado · reativar"}
                    </Button>
                  </form>
                </li>
              );
            })}
            {items.length === 0 && <li className="text-sm text-coffee-soft">Nenhum produto nesta seção.</li>}
          </ul>
        </section>
      ))}

      <ActionForm action={saveSection} resetOnSuccess className="flex flex-wrap items-end gap-2 rounded-card bg-white p-4 ring-1 ring-peach">
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
          Nova seção
          <input name="name" required maxLength={60} placeholder="Ex.: Pizzas" className={inputClass} />
        </label>
        <SubmitButton variant="secondary" className={small}>Criar seção</SubmitButton>
      </ActionForm>
    </div>
  );
}
