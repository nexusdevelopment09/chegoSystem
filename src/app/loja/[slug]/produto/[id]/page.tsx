import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ProductConfigurator } from "@/components/catalog/ProductConfigurator";
import { ProductImage } from "@/components/catalog/ProductImage";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { productStatus } from "@/lib/catalog/availability";
import { getProductDetail } from "@/lib/catalog/queries";
import { startingPriceCents } from "@/lib/catalog/selection";
import { now } from "@/lib/clock";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Produto" };

type Params = Promise<{ slug: string; id: string }>;

export default function ProductPage({ params }: { params: Params }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-4">
        <Suspense fallback={<ProductSkeleton />}>
          <ProductContent params={params} />
        </Suspense>
      </main>
    </>
  );
}

function ProductSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Carregando produto">
      <div className="aspect-square w-full rounded-card bg-peach" />
      <div className="h-8 w-2/3 rounded-full bg-peach" />
      <div className="h-40 rounded-card bg-peach" />
    </div>
  );
}

async function ProductContent({ params }: { params: Params }) {
  const { slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const product = await getProductDetail(id);
  if (!product || product.storeSlug !== slug) notFound();

  const status = productStatus(product.rules, await now());
  const hasChoices = product.groups.length > 0;
  const from = startingPriceCents(product.priceCents, product.groups);

  return (
    <article className="flex flex-col gap-4">
      <Link href={`/loja/${product.storeSlug}`} className="inline-flex min-h-11 items-center font-semibold text-brand-dark">
        ← {product.storeName}
      </Link>

      <ProductImage url={product.imageUrl} alt={product.name} size={672} priority className="aspect-square w-full rounded-card" />

      <header>
        <h1 className="text-3xl">{product.name}</h1>
        {product.description && <p className="mt-1 text-coffee-soft">{product.description}</p>}
        <p className="mt-2 text-xl font-bold">
          {product.pricePerKgCents ? (
            <>{formatCents(product.pricePerKgCents)}<span className="text-base font-normal text-coffee-soft"> o kg</span></>
          ) : (
            <>
              {hasChoices && from !== product.priceCents ? "A partir de " : ""}
              {formatCents(from)}
            </>
          )}
        </p>
        {status.note && (
          <p className="mt-2 inline-block rounded-full bg-peach px-3 py-1 text-sm font-bold text-brand-darker">{status.note}</p>
        )}
        {product.requiresAgeCheck && (
          <p className="mt-2 text-sm font-semibold text-coffee-soft">Venda só para maiores de 18 anos. Vamos conferir o documento na entrega.</p>
        )}
      </header>

      <ProductConfigurator
        product={{
          id: product.id, storeId: product.storeId, storeSlug: product.storeSlug, storeName: product.storeName,
          name: product.name, priceCents: product.priceCents, imageUrl: product.imageUrl,
          maxPerOrder: product.maxPerOrder, groups: product.groups,
          weightStepGrams: product.weightStepGrams, pricePerKgCents: product.pricePerKgCents, weightMinGrams: product.weightMinGrams,
        }}
        blockedReason={status.orderable ? null : status.note}
      />
    </article>
  );
}
