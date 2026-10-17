import { existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { STORAGE_DIR } from "@/lib/storage-dir";

export type CategoryItem = { slug: string; name: string };

/**
 * Os segmentos da cidade. No celular é uma faixa que desliza de lado (sem alargar a
 * página); a partir do tablet, todos lado a lado, distribuídos pela largura.
 */
export function CategoryNav({ categories }: { categories: CategoryItem[] }) {
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Categorias" className="scrollbar-none -mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex snap-x gap-1 md:grid md:grid-cols-[repeat(auto-fit,minmax(84px,1fr))] md:gap-2">
        {categories.map((category) => (
          <li key={category.slug} className="w-[84px] shrink-0 snap-start md:w-auto">
            <Link
              href={`/categoria/${category.slug}`}
              className="group flex h-full flex-col items-center gap-1.5 rounded-2xl px-1 pb-2 pt-1.5 text-center transition-colors hover:bg-white"
            >
              <CategoryPicture slug={category.slug} name={category.name} />
              <span className="line-clamp-2 min-h-8 text-xs font-semibold leading-4 text-coffee">{category.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function CategoryPicture({ slug, name }: { slug: string; name: string }) {
  const box = "flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-peach shadow-sm ring-1 ring-black/5 transition-transform duration-200 group-hover:-translate-y-0.5";
  if (existsSync(join(STORAGE_DIR, "categories", `${slug}.webp`))) {
    return (
      <span className={box}>
        {/* Imagem do segmento (240 px, poucos KB): <img> comum, o arquivo já está no tamanho certo. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/files/categories/${slug}.webp`} alt="" width={64} height={64} decoding="async" className="size-16 object-cover" />
      </span>
    );
  }
  // Sem imagem, a inicial do nome. (Um emoji aqui vira "quadradinho" em aparelhos sem a fonte.)
  return (
    <span className={`${box} font-display text-2xl font-bold text-brand-darker`} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
