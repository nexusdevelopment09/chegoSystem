// Gera uma foto por IA para cada produto do seed e guarda em db/seed/photos/.
//
//   npm run seed:photos              gera só as que ainda faltam
//   npm run seed:photos -- --force   gera todas de novo
//
// Usa o serviço gratuito Pollinations (https://pollinations.ai): o script envia só a
// descrição do produto, que é fictícia, e recebe a imagem. As fotos ficam guardadas no
// projeto, então o `npm run db:reset` funciona sem internet depois da primeira vez.
// Depois de gerar, rode `npm run seed:images` para as telas passarem a usar as fotos.
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { photoFile, PHOTOS_DIR } from "../db/seed/images.ts";
import { STORES } from "../db/seed/menus.ts";
import { hasOwnPrompt, keepsDrawing, photoPrompt } from "../db/seed/photo-prompts.ts";

const force = process.argv.includes("--force");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Número estável a partir do nome, para a mesma foto sair de novo se o script for repetido. */
const seedOf = (text: string) => [...text].reduce((value, char) => (value * 31 + char.codePointAt(0)!) % 100000, 7);

async function generate(name: string): Promise<Buffer> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(photoPrompt(name))}?width=800&height=800&seed=${seedOf(name)}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const type = response.headers.get("content-type") ?? "";
      if (response.ok && type.startsWith("image/")) return Buffer.from(await response.arrayBuffer());
      lastError = `resposta ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    // O serviço gratuito limita a quantidade de pedidos: espera cada vez mais antes de tentar de novo.
    await wait(attempt * 8000);
  }
  throw new Error(lastError);
}

// Lojas diferentes vendem produtos com o mesmo nome (refrigerante lata): uma foto serve para todas.
const names = [...new Set(STORES.flatMap((store) => store.products.filter((product) => !product.noImage && !keepsDrawing(product.name)).map((product) => product.name)))].sort();
const generic = names.filter((name) => !hasOwnPrompt(name));
if (generic.length > 0) console.log(`Sem descrição própria (vão com a descrição genérica): ${generic.join(", ")}`);

mkdirSync(PHOTOS_DIR, { recursive: true });
const pending = names.filter((name) => force || !existsSync(photoFile(name)));
console.log(`${names.length} produtos diferentes, ${pending.length} para gerar.`);

const failed: string[] = [];
for (const [index, name] of pending.entries()) {
  try {
    const image = await generate(name);
    // Guardada já pequena: 800 px em WebP. O seed tira dela os tamanhos que as telas usam.
    await sharp(image).resize(800, 800, { fit: "cover" }).webp({ quality: 74, effort: 5 }).toFile(photoFile(name));
    console.log(`[${index + 1}/${pending.length}] ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`[${index + 1}/${pending.length}] ${name}: FALHOU (${error instanceof Error ? error.message : error})`);
  }
  await wait(1500);
}

console.log(failed.length === 0 ? "Todas as fotos foram geradas." : `Faltaram ${failed.length}: ${failed.join(", ")}. Rode de novo para tentar só essas.`);
