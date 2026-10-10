import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/brand/Logo";
import { formatDateTime } from "@/lib/format";
import { currentLegalDocuments, LEGAL_SLUGS } from "@/lib/legal";

export const metadata: Metadata = { title: "Termos e privacidade" };

// Páginas públicas: /termos/uso, /termos/lojista e /termos/privacidade.
export default function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <Link href="/" aria-label="Chegô, página inicial">
        <Logo size={40} />
      </Link>
      <Suspense fallback={<p className="mt-8 text-coffee-soft">Carregando...</p>}>
        <LegalContent params={params} />
      </Suspense>
    </main>
  );
}

async function LegalContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const type = LEGAL_SLUGS[slug];
  if (!type) notFound();

  const document = (await currentLegalDocuments()).find((item) => item.type === type);
  if (!document) notFound();

  return (
    <article className="mt-8 rounded-card bg-white p-6 shadow-sm ring-1 ring-peach">
      <h1 className="text-3xl">{document.title}</h1>
      <p className="mb-6 text-sm text-coffee-soft">
        Versão {document.version}, publicada em {formatDateTime(document.publishedAt)}
      </p>
      {/* Mostrado como texto puro de propósito: o conteúdo nunca é tratado como HTML. */}
      <div className="whitespace-pre-wrap leading-relaxed">{document.content}</div>
    </article>
  );
}
