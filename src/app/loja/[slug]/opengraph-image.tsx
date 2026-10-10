import { ImageResponse } from "next/og";
import { sql } from "@/lib/db";

// Imagem de prévia para quando o link da loja é compartilhado (WhatsApp etc.).
export const alt = "Loja no Chegô";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [store] = await sql<{ name: string; description: string }[]>`
    select name, description from stores where slug = ${slug} and status in ('active', 'paused')`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
          padding: 80, background: "#E8611A", color: "#FFFFFF",
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 700, opacity: 0.9 }}>Peça pelo Chegô</div>
        <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.1, marginTop: 16 }}>{store?.name ?? "Chegô"}</div>
        <div style={{ fontSize: 34, marginTop: 24, opacity: 0.95 }}>{store?.description ?? "Tudo da cidade, numa sacola só."}</div>
        <div style={{ fontSize: 30, marginTop: 48, fontWeight: 700 }}>Pediu, Chegô.</div>
      </div>
    ),
    size,
  );
}
