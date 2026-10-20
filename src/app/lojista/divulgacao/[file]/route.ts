import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { getMerchantContext } from "@/lib/merchant/context";

// /lojista/divulgacao/qrcode  -> PNG do QR Code da loja
// /lojista/divulgacao/cartaz  -> cartaz A4 "Peça também pelo Chegô" (PDF)
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const { store } = await getMerchantContext("loja.config");
  const url = `${new URL(request.url).origin}/loja/${store.slug}`;
  const png = await QRCode.toBuffer(url, { type: "png", margin: 1, width: 900 });

  if (file === "qrcode") {
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="qrcode-${store.slug}.png"`, "Cache-Control": "no-store" },
    });
  }
  if (file !== "cartaz") return new Response("Not found", { status: 404 });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cartaz Chegô - ${store.name}`);
  const page = pdf.addPage([595.28, 841.89]); // A4 em pontos
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  const orange = rgb(0.91, 0.38, 0.1);
  const coffee = rgb(0.14, 0.09, 0.05);

  const centered = (text: string, y: number, size: number, font = bold, color = coffee) => {
    // As fontes padrão do PDF cobrem o Latin-1, o que basta para o português.
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  };

  page.drawRectangle({ x: 0, y: height - 200, width, height: 200, color: orange });
  centered("Peça também pelo", height - 95, 30, bold, rgb(1, 1, 1));
  centered("Chegô", height - 160, 64, bold, rgb(1, 1, 1));

  const shortName = store.name.length > 30 ? `${store.name.slice(0, 29)}…` : store.name;
  centered(shortName, height - 265, 30);
  centered("Aponte a câmera do celular para o código", height - 305, 16, regular);

  const image = await pdf.embedPng(png);
  const size = 320;
  page.drawImage(image, { x: (width - size) / 2, y: height - 650, width: size, height: size });

  centered("Pediu, Chegô.", 130, 34, bold, orange);
  centered("Tudo da cidade, numa sacola só.", 95, 16, regular);
  centered(url, 55, 11, regular);

  const bytes = await pdf.save();
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="cartaz-${store.slug}.pdf"`, "Cache-Control": "no-store" },
  });
}
