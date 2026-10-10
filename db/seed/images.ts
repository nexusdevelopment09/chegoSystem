// Gera as fotos falsas do seed, localmente: SVG desenhado aqui e
// convertido para WebP com o sharp. Nada é baixado da internet.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { STORES, type Art } from "./menus.ts";

const STORAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "storage");

export const slugify = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// URLs públicas, servidas por src/app/files/[...path]/route.ts.
// A versão de 400px da foto de um produto é o mesmo caminho terminado em "-400.webp".
export const productImageUrl = (storeSlug: string, productName: string) =>
  `/files/products/${storeSlug}/${slugify(productName)}-800.webp`;
export const storeLogoUrl = (storeSlug: string) => `/files/stores/${storeSlug}-logo.webp`;
export const storeCoverUrl = (storeSlug: string) => `/files/stores/${storeSlug}-cover.webp`;
export const bannerImageUrl = (key: string) => `/files/banners/${key}.webp`;

export const BANNERS = [
  { key: "primeira-compra", title: "Primeira compra com R$ 10 off", subtitle: "Use o cupom PRIMEIRA", color: "#E8611A" },
  { key: "sexta-da-pizza", title: "Sexta da pizza", subtitle: "Peça a sua na Forno de Barro", color: "#B4480F" },
  { key: "acai-em-dobro", title: "Açaí em dobro no domingo", subtitle: "Só no Açaí Tropical", color: "#5B2A86" },
];

export const CATEGORY_COLORS: Record<string, string> = {
  restaurantes: "#C2410C",
  lanches: "#B45309",
  "cafe-da-manha": "#A16207",
  "acai-e-sobremesas": "#6D28D9",
  bebidas: "#1D4ED8",
  mercado: "#15803D",
  farmacia: "#0F766E",
  saudavel: "#4D7C0F",
};

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxChars - 1)}…`;
  }
  return lines;
}

// Desenhos brancos simples, centrados em (400, 300) de uma tela de 800x800.
const W = `fill="#FFFFFF"`;
const SHADE = `fill="#000000" fill-opacity="0.18"`;
const ART: Record<Art, string> = {
  pizza: `<circle cx="400" cy="300" r="170" ${W}/><circle cx="400" cy="300" r="140" ${SHADE}/>
    <g stroke="#FFFFFF" stroke-width="8"><path d="M400 130v340M230 300h340M280 180l240 240M520 180L280 420"/></g>
    <g ${W}><circle cx="345" cy="235" r="18"/><circle cx="470" cy="260" r="18"/><circle cx="440" cy="370" r="18"/><circle cx="330" cy="350" r="18"/></g>`,
  burger: `<path d="M240 270a160 120 0 0 1 320 0z" ${W}/><rect x="225" y="285" width="350" height="34" rx="17" ${SHADE}/>
    <rect x="235" y="330" width="330" height="46" rx="20" ${W}/><rect x="225" y="388" width="350" height="26" rx="13" ${SHADE}/>
    <path d="M240 426h320v20a40 40 0 0 1-40 40H280a40 40 0 0 1-40-40z" ${W}/>`,
  acai: `<path d="M290 230h220l-34 240a24 24 0 0 1-24 20H348a24 24 0 0 1-24-20z" ${W}/>
    <path d="M280 230a120 90 0 0 1 240 0z" ${SHADE}/><circle cx="350" cy="190" r="22" ${W}/><circle cx="410" cy="165" r="22" ${W}/><circle cx="460" cy="195" r="22" ${W}/>`,
  bottle: `<rect x="372" y="110" width="56" height="60" rx="10" ${W}/><path d="M360 180h80l30 80v210a30 30 0 0 1-30 30h-80a30 30 0 0 1-30-30V260z" ${W}/>
    <rect x="330" y="300" width="140" height="90" ${SHADE}/>`,
  grocery: `<path d="M250 230h300l-24 250a24 24 0 0 1-24 20H298a24 24 0 0 1-24-20z" ${W}/>
    <path d="M330 240v-50a70 70 0 0 1 140 0v50" fill="none" stroke="#FFFFFF" stroke-width="22" stroke-linecap="round"/>
    <rect x="290" y="300" width="220" height="24" rx="12" ${SHADE}/>`,
  medicine: `<rect x="240" y="170" width="320" height="270" rx="28" ${W}/><rect x="240" y="170" width="320" height="64" rx="28" ${SHADE}/>
    <path d="M376 270h48v46h46v48h-46v46h-48v-46h-46v-48h46z" ${SHADE}/>`,
  fish: `<ellipse cx="380" cy="300" rx="170" ry="95" ${W}/><path d="M530 300l110-90v180z" ${W}/>
    <circle cx="290" cy="275" r="16" ${SHADE}/><path d="M360 230q40 70 0 140" fill="none" stroke="#000000" stroke-opacity="0.18" stroke-width="10"/>`,
  bread: `<rect x="210" y="210" width="380" height="190" rx="95" ${W}/>
    <g stroke="#000000" stroke-opacity="0.18" stroke-width="16" stroke-linecap="round"><path d="M320 250l-30 110M410 250l-30 110M500 250l-30 110"/></g>`,
  lunchbox: `<rect x="210" y="180" width="380" height="250" rx="34" ${W}/><rect x="238" y="208" width="190" height="194" rx="18" ${SHADE}/>
    <rect x="446" y="208" width="116" height="88" rx="18" ${SHADE}/><rect x="446" y="314" width="116" height="88" rx="18" ${SHADE}/>`,
  sushi: `<circle cx="310" cy="300" r="105" ${W}/><circle cx="310" cy="300" r="70" ${SHADE}/><circle cx="310" cy="300" r="32" ${W}/>
    <circle cx="510" cy="300" r="105" ${W}/><circle cx="510" cy="300" r="70" ${SHADE}/><circle cx="510" cy="300" r="32" ${W}/>`,
  cake: `<rect x="250" y="300" width="300" height="150" rx="20" ${W}/><rect x="285" y="210" width="230" height="100" rx="20" ${W}/>
    <rect x="250" y="360" width="300" height="24" ${SHADE}/><rect x="285" y="250" width="230" height="20" ${SHADE}/><circle cx="400" cy="180" r="26" ${W}/>`,
  jar: `<rect x="300" y="130" width="200" height="56" rx="14" ${W}/><rect x="270" y="200" width="260" height="290" rx="44" ${W}/>
    <rect x="300" y="280" width="200" height="120" rx="14" ${SHADE}/>`,
};

function productSvg(name: string, art: Art, color: string) {
  const lines = wrap(name, 22, 3);
  const text = lines
    .map((line, index) => `<text x="400" y="${600 + index * 58}" text-anchor="middle">${escapeXml(line)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="${color}"/>
    <circle cx="400" cy="300" r="250" fill="#FFFFFF" fill-opacity="0.12"/>
    ${ART[art]}
    <g font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="700" fill="#FFFFFF">${text}</g>
  </svg>`;
}

function logoSvg(name: string, color: string) {
  const initials = name
    .split(" ")
    .filter((word) => word.length > 2)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <circle cx="200" cy="200" r="200" fill="${color}"/>
    <text x="200" y="250" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="700" fill="#FFFFFF">${escapeXml(initials)}</text>
  </svg>`;
}

function patternSvg(width: number, height: number, color: string, title: string, subtitle?: string) {
  const shapes: string[] = [];
  for (let x = 0; x < width; x += 120) {
    for (let y = 0; y < height; y += 120) {
      const even = (x / 120 + y / 120) % 2 === 0;
      shapes.push(
        even
          ? `<circle cx="${x + 60}" cy="${y + 60}" r="44" fill="#FFFFFF" fill-opacity="0.08"/>`
          : `<rect x="${x + 22}" y="${y + 22}" width="76" height="76" rx="18" fill="#000000" fill-opacity="0.08"/>`,
      );
    }
  }
  const titleY = subtitle ? height / 2 - 6 : height / 2 + 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${color}"/>${shapes.join("")}
    <g font-family="Arial, Helvetica, sans-serif" fill="#FFFFFF" text-anchor="middle">
      <text x="${width / 2}" y="${titleY}" font-size="72" font-weight="700">${escapeXml(title)}</text>
      ${subtitle ? `<text x="${width / 2}" y="${titleY + 70}" font-size="40">${escapeXml(subtitle)}</text>` : ""}
    </g>
  </svg>`;
}

async function write(path: string, svg: string, width: number, height: number, force: boolean) {
  const file = join(STORAGE, path);
  if (!force && existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).resize(width, height).webp({ quality: 80 }).toFile(file);
  return true;
}

/** Grava todas as fotos do seed em storage/. Arquivos que já existem são mantidos, a não ser com `force`. */
export async function generateImages({ force = false } = {}) {
  const jobs: Promise<boolean>[] = [];

  for (const store of STORES) {
    jobs.push(write(`stores/${store.slug}-logo.webp`, logoSvg(store.name, store.color), 400, 400, force));
    jobs.push(write(`stores/${store.slug}-cover.webp`, patternSvg(1200, 400, store.color, store.name), 1200, 400, force));

    const color = CATEGORY_COLORS[store.category] ?? "#E8611A";
    for (const product of store.products) {
      if (product.noImage) continue;
      const svg = productSvg(product.name, product.art, color);
      const base = `products/${store.slug}/${slugify(product.name)}`;
      jobs.push(write(`${base}-800.webp`, svg, 800, 800, force));
      jobs.push(write(`${base}-400.webp`, svg, 400, 400, force));
    }
  }

  for (const banner of BANNERS) {
    jobs.push(write(`banners/${banner.key}.webp`, patternSvg(1200, 500, banner.color, banner.title, banner.subtitle), 1200, 500, force));
  }

  const written = (await Promise.all(jobs)).filter(Boolean).length;
  return { total: jobs.length, written };
}

// `npm run seed:images` gera tudo de novo.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await generateImages({ force: true });
  console.log(`${result.written} imagens geradas em storage/.`);
}
