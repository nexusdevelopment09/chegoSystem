import Link from "next/link";

/** "← Anterior · Página 2 de 7 · Próxima →" (a paginação é feita no servidor). */
export function Pagination({ page, total, size, href }: { page: number; total: number; size: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const link = "flex min-h-11 items-center rounded-full px-4 font-semibold ring-1 ring-peach hover:ring-brand";
  return (
    <nav aria-label="Páginas" className="flex flex-wrap items-center gap-2 text-sm">
      {page > 1 && <Link href={href(page - 1)} className={link}>← Anterior</Link>}
      <span>Página {Math.min(page, pages)} de {pages}</span>
      {page < pages && <Link href={href(page + 1)} className={link}>Próxima →</Link>}
    </nav>
  );
}
