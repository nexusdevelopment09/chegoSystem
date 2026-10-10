import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { STORAGE_DIR } from "@/lib/storage-dir";

// O arquivo que chega pode ser grande (foto de celular); o que fica guardado é sempre pequeno.
const MAX_BYTES = 15 * 1024 * 1024;
// Fotos gigantes (mais de 50 megapixels) são recusadas antes de ocupar a memória do servidor.
const MAX_PIXELS = 50_000_000;

export class UploadError extends Error {}

type Variant = { suffix: string; width: number; height: number; /** "inside" guarda a foto inteira, sem cortar (padrão: corta para preencher). */ fit?: "cover" | "inside" };

// A primeira variante é a principal (o endereço guardado no banco). As outras são
// versões menores do mesmo arquivo, que o celular baixa no lugar da grande.
export const PRODUCT_VARIANTS: Variant[] = [
  { suffix: "-800", width: 800, height: 800 },
  { suffix: "-400", width: 400, height: 400 },
];
export const LOGO_VARIANTS: Variant[] = [
  { suffix: "-logo", width: 400, height: 400 },
  // 192px: cobre o logo de 64px mesmo nos celulares com tela de densidade 3.
  { suffix: "-logo-small", width: 192, height: 192 },
];
export const COVER_VARIANTS: Variant[] = [
  { suffix: "-cover", width: 1200, height: 400 },
  { suffix: "-cover-small", width: 600, height: 200 },
];
export const BANNER_VARIANTS: Variant[] = [
  { suffix: "-banner", width: 1200, height: 500 },
  { suffix: "-banner-small", width: 600, height: 250 },
];

/**
 * Guarda uma foto enviada. Aceita qualquer formato de imagem (JPG, PNG, WebP, GIF,
 * AVIF, TIFF, SVG...): confere que o arquivo é mesmo uma imagem (pelo conteúdo, não
 * pelo nome) e regrava em WebP nos tamanhos necessários, sempre leve. Regravar também
 * apaga todos os metadados, como a posição do GPS que o celular salva.
 * Devolve o endereço público da primeira variante.
 */
export async function saveImage(file: File, bucket: "products" | "stores" | "banners", folder: string, variants: Variant[]): Promise<string> {
  if (file.size === 0) throw new UploadError("Escolha uma imagem.");
  if (file.size > MAX_BYTES) throw new UploadError("A imagem é muito grande. O limite é 15 MB.");

  const input = Buffer.from(await file.arrayBuffer());
  const open = () => sharp(input, { limitInputPixels: MAX_PIXELS, animated: false });
  try {
    const metadata = await open().metadata();
    if (!metadata.format || !metadata.width || !metadata.height) throw new Error("not an image");
  } catch {
    throw new UploadError("Não deu para abrir esse arquivo como imagem. Envie uma foto (JPG, PNG, WebP, GIF, AVIF...).");
  }

  const name = randomUUID();
  const directory = join(STORAGE_DIR, bucket, folder);
  await mkdir(directory, { recursive: true });

  try {
    for (const variant of variants) {
      await open()
        .rotate() // aplica a orientação da câmera antes de os metadados serem apagados
        .resize(variant.width, variant.height, { fit: variant.fit ?? "cover", withoutEnlargement: variant.fit === "inside" })
        .webp({ quality: 76, effort: 4 })
        .toFile(join(directory, `${name}${variant.suffix}.webp`));
    }
  } catch {
    throw new UploadError("Não deu para ler essa imagem. Tente outra foto.");
  }
  return `/files/${bucket}/${folder ? `${folder}/` : ""}${name}${variants[0].suffix}.webp`;
}

/** O arquivo escolhido em um campo do formulário, ou null quando o campo ficou vazio. */
export function pickedFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}
