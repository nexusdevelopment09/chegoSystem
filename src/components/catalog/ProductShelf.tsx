import Link from "next/link";
import type { ReactNode } from "react";
import { ProductImage } from "@/components/catalog/ProductImage";
import { HScroller } from "@/components/ui/HScroller";
import type { ShowcaseProduct } from "@/lib/catalog/showcase";
import { formatCents } from "@/lib/format";

export type ShelfBadge = "oferta" | "mais-pedido" | "destaque" | "novo" | "de-novo";

const BADGES: Record<Exclude<ShelfBadge, "oferta">, string> = {
  "mais-pedido": "Mais pedido",
  destaque: "Destaque",
  novo: "Novo",
  "de-novo": "Você já pediu",
};

/** Desconto de uma oferta, arredondado para baixo: R$ 30 por R$ 25 -> 16%. */
export function discountPercent(priceCents: number, compareAtCents: number | null): number | null {
  if (!compareAtCents || compareAtCents <= priceCents) return null;
  return Math.floor(((compareAtCents - priceCents) / compareAtCents) * 100);
}

/** Preço com o "de" riscado quando há oferta. Por peso, o preço do quilo. */
export function PriceTag({ product, size = "base" }: { product: Pick<ShowcaseProduct, "fromCents" | "priceVaries" | "pricePerKgCents" | "compareAtCents">; size?: "base" | "sm" }) {
  if (product.pricePerKgCents) {
    return (
      <span className="font-bold">
        {formatCents(product.pricePerKgCents)}<span className="text-sm font-normal text-coffee-soft">/kg</span>
      </span>
    );
  }
  const offer = discountPercent(product.fromCents, product.compareAtCents) !== null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      {product.priceVaries && <span className="text-xs font-normal text-coffee-soft">a partir de</span>}
      <span className={`font-bold ${offer ? "text-success" : ""} ${size === "sm" ? "text-sm" : ""}`}>{formatCents(product.fromCents)}</span>
      {offer && (
        <s className="text-xs text-coffee-soft" aria-label={`antes ${formatCents(product.compareAtCents!)}`}>{formatCents(product.compareAtCents!)}</s>
      )}
    </span>
  );
}

/**
 * Card de produto das vitrines. O card inteiro leva à página do produto, onde o cliente
 * escolhe as opções e adiciona ao carrinho (o mesmo fluxo de compra de sempre).
 */
export function ProductCard({ product, badge, showStore = false, fluid = false }: {
  product: ShowcaseProduct; badge?: ShelfBadge; showStore?: boolean;
  /** Em grade: ocupa a coluna inteira em vez da largura fixa da faixa. */
  fluid?: boolean;
}) {
  const discount = discountPercent(product.fromCents, product.compareAtCents);
  const label = discount !== null ? `-${discount}%` : badge && badge !== "oferta" ? BADGES[badge] : null;
  return (
    <li className={fluid ? "min-w-0" : "w-[9.5rem] shrink-0 snap-start sm:w-44"}>
      <Link
        href={`/loja/${product.storeSlug}/produto/${product.id}`}
        data-testid="shelf-product"
        className="group flex h-full flex-col overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-peach transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand"
      >
        <div className="relative">
          <ProductImage url={product.imageUrl} alt="" size={176} className="aspect-square w-full" />
          {label && (
            <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold shadow-sm ${discount !== null ? "bg-success text-white" : "bg-white text-brand-darker"}`}>
              {label}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-2.5">
          <p className="line-clamp-2 text-sm font-semibold leading-tight">{product.name}</p>
          {showStore && <p className="truncate text-xs text-coffee-soft">{product.storeName}</p>}
          {product.status.note && <p className="line-clamp-1 text-xs font-semibold text-brand-darker">{product.status.note}</p>}
          <div className="mt-auto flex items-end justify-between gap-1 pt-1">
            <PriceTag product={product} size="sm" />
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-dark text-lg font-bold leading-none text-white transition group-hover:bg-brand-darker">+</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Uma vitrine: título e a faixa de produtos com setas. Sem produtos, não aparece. */
export function ProductShelf({ title, note, products, badge, showStore = false, action, testId }: {
  title: string; note?: string; products: ShowcaseProduct[]; badge?: ShelfBadge; showStore?: boolean; action?: ReactNode; testId?: string;
}) {
  if (products.length === 0) return null;
  return (
    <section data-testid={testId} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-xl sm:text-2xl">
          {title}
          {note && <span className="font-sans text-sm font-normal text-coffee-soft">{note}</span>}
        </h2>
        {action}
      </div>
      <HScroller label={title}>
        {products.map((product) => <ProductCard key={product.id} product={product} badge={badge} showStore={showStore} />)}
      </HScroller>
    </section>
  );
}
