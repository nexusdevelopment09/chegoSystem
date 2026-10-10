import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/Button";
import { getMerchantContext } from "@/lib/merchant/context";

export const metadata: Metadata = { title: "Material de divulgação" };

export default function PromoPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Promo />
    </Suspense>
  );
}

async function Promo() {
  const { store } = await getMerchantContext(["owner"]);
  const host = (await headers()).get("host") ?? "localhost:3000";
  const url = `http://${host}/loja/${store.slug}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 260 });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl">Material de divulgação</h1>
      <section className="flex flex-col items-center gap-3 rounded-card bg-white p-6 text-center ring-1 ring-peach">
        <h2 className="text-xl">QR Code da sua loja</h2>
        <p className="text-sm text-coffee-soft">Quem apontar a câmera cai direto na página da {store.name}.</p>
        {/* SVG gerado no servidor pela biblioteca de QR, a partir do endereço da própria loja. */}
        <div role="img" aria-label={`QR Code de ${url}`} data-testid="store-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="break-all text-sm font-semibold">{url}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <a href="/lojista/divulgacao/qrcode" download className={buttonClass("secondary")}>Baixar QR Code (PNG)</a>
          <a href="/lojista/divulgacao/cartaz" download className={buttonClass("primary")}>Baixar cartaz (PDF)</a>
        </div>
        <p className="text-sm text-coffee-soft">O cartaz é uma folha A4 com “Peça também pelo Chegô” para imprimir e colar no balcão.</p>
      </section>
    </div>
  );
}
