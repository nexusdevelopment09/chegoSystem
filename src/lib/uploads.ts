import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const STORAGE = join(process.cwd(), "storage");
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["jpeg", "png", "webp"];

export class UploadError extends Error {}

type Variant = { suffix: string; width: number; height: number };

export const PRODUCT_VARIANTS: Variant[] = [
  { suffix: "-800", width: 800, height: 800 },
  { suffix: "-400", width: 400, height: 400 },
];
export const LOGO_VARIANTS: Variant[] = [{ suffix: "-logo", width: 400, height: 400 }];
export const COVER_VARIANTS: Variant[] = [{ suffix: "-cover", width: 1200, height: 400 }];
export const BANNER_VARIANTS: Variant[] = [{ suffix: "", width: 1200, height: 500 }];

/**
 * Stores an uploaded picture: checks the real file type (not the name) and
 * the size, then re-encodes it as WebP in the sizes needed. Re-encoding also
 * drops every piece of metadata, such as the GPS position a phone saves.
 * Returns the public address of the first variant.
 */
export async function saveImage(file: File, bucket: "products" | "stores" | "banners", folder: string, variants: Variant[]): Promise<string> {
  if (file.size === 0) throw new UploadError("Escolha uma imagem.");
  if (file.size > MAX_BYTES) throw new UploadError("A imagem é muito grande. O limite é 5 MB.");

  const input = Buffer.from(await file.arrayBuffer());
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    format = undefined;
  }
  if (!format || !ALLOWED.includes(format)) throw new UploadError("Use uma imagem JPG, PNG ou WebP.");

  const name = randomUUID();
  const directory = join(STORAGE, bucket, folder);
  await mkdir(directory, { recursive: true });

  for (const variant of variants) {
    await sharp(input)
      .rotate() // applies the camera orientation before the metadata is dropped
      .resize(variant.width, variant.height, { fit: "cover" })
      .webp({ quality: 80 })
      .toFile(join(directory, `${name}${variant.suffix}.webp`));
  }
  return `/files/${bucket}/${folder ? `${folder}/` : ""}${name}${variants[0].suffix}.webp`;
}

/** The file chosen in a form field, or null when the field was left empty. */
export function pickedFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}
