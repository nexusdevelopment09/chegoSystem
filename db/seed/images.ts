// Gera as fotos falsas do seed, localmente: SVG desenhado aqui e
// convertido para WebP com o sharp. Nada é baixado da internet.
//
// Cada produto ganha um desenho colorido escolhido pelo nome ("Cerveja" vira
// garrafa âmbar, "Tomate" vira hortifrúti vermelho...), sobre um fundo claro com
// o tom da loja. Cada loja ganha logo e capa com os desenhos do que ela vende, e
// cada segmento (categoria) ganha a sua imagem.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CATEGORIES } from "./people.ts";
import { STORES, type Art } from "./menus.ts";

// Os testes automáticos gravam em outra pasta (STORAGE_DIR), para não misturar com as fotos de quem testa à mão.
const STORAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", process.env.STORAGE_DIR ?? "storage");

/** Fotos dos produtos geradas por IA (`npm run seed:photos`), uma por nome de produto. Ficam guardadas no projeto. */
export const PHOTOS_DIR = join(dirname(fileURLToPath(import.meta.url)), "photos");
export const photoFile = (productName: string) => join(PHOTOS_DIR, `${slugify(productName)}.webp`);

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
export const categoryImageUrl = (slug: string) => `/files/categories/${slug}.webp`;

export const BANNERS = [
  { key: "primeira-compra", title: "Primeira compra com R$ 10 off", subtitle: "Use o cupom PRIMEIRA", color: "#B4480F", arts: ["burger", "cup", "fries"] },
  { key: "sexta-da-pizza", title: "Sexta da pizza", subtitle: "Peça a sua na Forno de Barro", color: "#8F2D12", arts: ["pizza", "bottle", "pizza"] },
  { key: "acai-em-dobro", title: "Açaí em dobro no domingo", subtitle: "Só no Açaí Tropical", color: "#5B2A86", arts: ["acai", "acai", "cake"] },
] as const;

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

/** Os desenhos que representam cada segmento. */
const CATEGORY_ARTS: Record<string, Drawing[]> = {
  restaurantes: ["pizza", "lunchbox", "sushi"],
  lanches: ["burger", "fries", "snack"],
  "cafe-da-manha": ["bread", "cup", "dish"],
  "acai-e-sobremesas": ["acai", "cake", "cup"],
  bebidas: ["bottle", "can", "bag"],
  mercado: ["produce", "package", "carton"],
  farmacia: ["medicine", "hygiene", "cleaning"],
  saudavel: ["jar", "tub", "produce"],
};

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Número estável a partir de um texto, para variar cores sem sorteio. */
function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.codePointAt(0)!) >>> 0;
  return value;
}

/** Mistura a cor com branco (amount de 0 a 1) ou com preto (negativo). */
function mix(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const weight = Math.abs(amount);
  const channel = (start: number) => Math.round(parseInt(hex.slice(start, start + 2), 16) * (1 - weight) + target * weight);
  return `#${[1, 3, 5].map((start) => channel(start).toString(16).padStart(2, "0")).join("")}`;
}

// ------------------------------------------------------------------ desenhos

type Drawing = Art;
type Colors = { main: string; second: string };

const INK = "#3B2413";

// Cada desenho ocupa uma caixa de 200x200, com o centro em (100, 100).
const DRAW: Record<Drawing, (colors: Colors) => string> = {
  pizza: ({ main, second }) => `
    <circle cx="100" cy="100" r="86" fill="#C98A3C"/><circle cx="100" cy="100" r="74" fill="#F4C95D"/>
    <g fill="${main}"><circle cx="72" cy="70" r="11"/><circle cx="128" cy="78" r="11"/><circle cx="118" cy="130" r="11"/><circle cx="66" cy="124" r="11"/><circle cx="98" cy="98" r="9"/></g>
    <g fill="${second}"><circle cx="100" cy="52" r="5"/><circle cx="148" cy="108" r="5"/><circle cx="92" cy="150" r="5"/><circle cx="50" cy="96" r="5"/><circle cx="140" cy="58" r="4"/></g>
    <g stroke="#C98A3C" stroke-width="2.5" stroke-opacity="0.7"><path d="M100 26v148M26 100h148M48 48l104 104M152 48L48 152"/></g>`,
  burger: ({ main }) => `
    <path d="M30 88a70 52 0 0 1 140 0z" fill="#D98E3F"/>
    <g fill="#FBE7C2"><ellipse cx="70" cy="60" rx="5" ry="3"/><ellipse cx="100" cy="50" rx="5" ry="3"/><ellipse cx="130" cy="62" rx="5" ry="3"/><ellipse cx="88" cy="72" rx="5" ry="3"/><ellipse cx="116" cy="74" rx="5" ry="3"/></g>
    <path d="M24 94q12 14 25 0t25 0t25 0t25 0t25 0t27 0v10H24z" fill="#5FAE4B"/>
    <path d="M26 104h148l-18 14H44z" fill="${main}"/>
    <rect x="28" y="116" width="144" height="24" rx="12" fill="#6B3A1E"/>
    <path d="M30 144h140v8a22 22 0 0 1-22 22H52a22 22 0 0 1-22-22z" fill="#D98E3F"/>`,
  acai: ({ main, second }) => `
    <path d="M52 78h96l-14 92a10 10 0 0 1-10 8H76a10 10 0 0 1-10-8z" fill="#FFFFFF" stroke="#E7DCCB" stroke-width="3"/>
    <path d="M60 110h80l-8 56a8 8 0 0 1-8 7H76a8 8 0 0 1-8-7z" fill="#4C1D95" fill-opacity="0.18"/>
    <path d="M46 80a54 40 0 0 1 108 0z" fill="#4C1D95"/>
    <circle cx="74" cy="58" r="11" fill="${main}"/><circle cx="100" cy="46" r="11" fill="#F4C95D"/><circle cx="126" cy="58" r="11" fill="${second}"/>
    <g fill="#E9D8B4"><circle cx="88" cy="68" r="4"/><circle cx="112" cy="68" r="4"/><circle cx="100" cy="62" r="4"/></g>`,
  bottle: ({ main, second }) => `
    <rect x="86" y="14" width="28" height="22" rx="5" fill="${second}"/>
    <path d="M84 40h32l14 38v92a14 14 0 0 1-14 14H84a14 14 0 0 1-14-14V78z" fill="${main}"/>
    <rect x="70" y="96" width="60" height="44" fill="#FFFFFF" fill-opacity="0.9"/><rect x="78" y="106" width="44" height="8" rx="4" fill="${second}"/><rect x="78" y="120" width="30" height="6" rx="3" fill="${main}" fill-opacity="0.5"/>
    <path d="M80 50l-6 30v84" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="6" stroke-linecap="round"/>`,
  can: ({ main, second }) => `
    <rect x="58" y="28" width="84" height="150" rx="16" fill="${main}"/>
    <rect x="58" y="28" width="84" height="16" rx="8" fill="#D9D9D9"/><rect x="58" y="162" width="84" height="16" rx="8" fill="#BDBDBD"/>
    <rect x="58" y="80" width="84" height="46" fill="${second}"/><circle cx="100" cy="103" r="14" fill="#FFFFFF" fill-opacity="0.9"/>
    <rect x="68" y="48" width="8" height="110" rx="4" fill="#FFFFFF" fill-opacity="0.3"/>`,
  grocery: ({ main }) => `
    <path d="M40 76h120l-10 96a10 10 0 0 1-10 9H60a10 10 0 0 1-10-9z" fill="#E8C9A0"/>
    <path d="M70 80V60a30 30 0 0 1 60 0v20" fill="none" stroke="#B88A5A" stroke-width="8" stroke-linecap="round"/>
    <circle cx="78" cy="70" r="16" fill="#D8412F"/><circle cx="122" cy="68" r="15" fill="#F4C95D"/><path d="M92 52q8-26 22-8q-10 4-12 22z" fill="${main}"/>
    <path d="M40 76h120l-2 18H42z" fill="#D2AE82"/>`,
  package: ({ main, second }) => `
    <path d="M50 44h100l8 126a10 10 0 0 1-10 10H52a10 10 0 0 1-10-10z" fill="#FAF3E7" stroke="#E2D3BC" stroke-width="3"/>
    <path d="M50 44q50-18 100 0v14H50z" fill="${main}"/>
    <rect x="46" y="86" width="108" height="56" fill="${main}"/><rect x="62" y="100" width="76" height="10" rx="5" fill="#FFFFFF"/><rect x="62" y="118" width="48" height="8" rx="4" fill="#FFFFFF" fill-opacity="0.7"/>
    <circle cx="132" cy="160" r="9" fill="${second}"/>`,
  carton: ({ main, second }) => `
    <path d="M62 62l38-36l38 36v108a8 8 0 0 1-8 8H70a8 8 0 0 1-8-8z" fill="#FFFFFF" stroke="#DCE6EE" stroke-width="3"/>
    <path d="M62 62l38-36l38 36z" fill="${main}"/><rect x="62" y="98" width="76" height="46" fill="${main}"/>
    <circle cx="100" cy="121" r="13" fill="#FFFFFF"/><rect x="74" y="152" width="52" height="7" rx="3.5" fill="${second}"/>`,
  produce: ({ main, second }) => `
    <ellipse cx="100" cy="160" rx="76" ry="14" fill="#000000" fill-opacity="0.08"/>
    <circle cx="70" cy="118" r="38" fill="${main}"/><circle cx="128" cy="124" r="34" fill="${second}"/><circle cx="102" cy="78" r="32" fill="${main}"/>
    <path d="M100 50q4-22 22-18q-6 12-22 18z" fill="#4E9A3B"/><path d="M68 84q-2-18 12-20q0 12-12 20z" fill="#4E9A3B"/>
    <g fill="#FFFFFF" fill-opacity="0.35"><ellipse cx="58" cy="104" rx="8" ry="5"/><ellipse cx="92" cy="66" rx="7" ry="4"/><ellipse cx="118" cy="112" rx="7" ry="4"/></g>`,
  tray: ({ main, second }) => `
    <rect x="22" y="56" width="156" height="104" rx="18" fill="#F3F4F6" stroke="#D5D9DE" stroke-width="3"/>
    <path d="M44 106q8-34 44-28q26-6 34 16q22 2 30 20q-6 26-40 22q-22 12-44 2q-28-4-24-32z" fill="${main}"/>
    <path d="M62 104q14-14 34-8M96 122q16 4 30-6" fill="none" stroke="${second}" stroke-width="5" stroke-linecap="round"/>
    <rect x="34" y="66" width="132" height="10" rx="5" fill="#FFFFFF" fill-opacity="0.6"/>`,
  cleaning: ({ main, second }) => `
    <path d="M86 20h34v16H98z" fill="${second}"/><path d="M118 22h26v12l-26 6z" fill="${second}"/>
    <rect x="82" y="38" width="34" height="18" rx="4" fill="#E5E7EB"/>
    <path d="M70 62h60a12 12 0 0 1 12 12v94a12 12 0 0 1-12 12H70a12 12 0 0 1-12-12V74a12 12 0 0 1 12-12z" fill="${main}"/>
    <rect x="68" y="96" width="64" height="50" rx="8" fill="#FFFFFF" fill-opacity="0.92"/><circle cx="100" cy="121" r="13" fill="${second}"/>`,
  hygiene: ({ main, second }) => `
    <rect x="36" y="62" width="128" height="92" rx="14" fill="#FFFFFF" stroke="#DCE6EE" stroke-width="3"/>
    <rect x="36" y="62" width="128" height="28" rx="14" fill="${main}"/><rect x="36" y="78" width="128" height="12" fill="${main}"/>
    <circle cx="74" cy="122" r="16" fill="${second}" fill-opacity="0.8"/><rect x="100" y="110" width="50" height="8" rx="4" fill="${main}" fill-opacity="0.6"/><rect x="100" y="126" width="34" height="7" rx="3.5" fill="${main}" fill-opacity="0.35"/>`,
  medicine: ({ main, second }) => `
    <rect x="34" y="50" width="132" height="110" rx="14" fill="#FFFFFF" stroke="#D5E3E1" stroke-width="3"/>
    <rect x="34" y="50" width="132" height="30" rx="14" fill="${main}"/><rect x="34" y="68" width="132" height="12" fill="${main}"/>
    <path d="M90 94h20v16h16v20h-16v16H90v-16H74v-20h16z" fill="${second}"/>`,
  fish: ({ main, second }) => `
    <ellipse cx="100" cy="166" rx="72" ry="10" fill="#000000" fill-opacity="0.07"/>
    <path d="M150 100l40-36v72z" fill="${second}"/>
    <ellipse cx="92" cy="100" rx="74" ry="42" fill="${main}"/><path d="M60 62q30-22 60 0z" fill="${second}"/>
    <ellipse cx="92" cy="112" rx="56" ry="22" fill="#FFFFFF" fill-opacity="0.35"/>
    <circle cx="48" cy="90" r="8" fill="#FFFFFF"/><circle cx="48" cy="90" r="4" fill="${INK}"/>
    <path d="M76 74q16 26 0 52" fill="none" stroke="${second}" stroke-width="4"/>`,
  bread: ({ main }) => `
    <ellipse cx="100" cy="160" rx="78" ry="10" fill="#000000" fill-opacity="0.07"/>
    <rect x="20" y="66" width="160" height="84" rx="42" fill="#C9822F"/><rect x="26" y="70" width="148" height="60" rx="30" fill="${main}"/>
    <g stroke="#FBE7C2" stroke-width="7" stroke-linecap="round"><path d="M66 80l-12 36M100 80l-12 36M134 80l-12 36"/></g>`,
  lunchbox: ({ main }) => `
    <rect x="18" y="42" width="164" height="118" rx="18" fill="#2F3338"/>
    <rect x="30" y="54" width="82" height="94" rx="10" fill="#FFFDF7"/><g fill="#E9E2D0"><circle cx="50" cy="76" r="3"/><circle cx="72" cy="92" r="3"/><circle cx="56" cy="116" r="3"/><circle cx="90" cy="70" r="3"/><circle cx="92" cy="128" r="3"/></g>
    <rect x="120" y="54" width="50" height="42" rx="10" fill="#6B3A1E"/><rect x="120" y="104" width="50" height="44" rx="10" fill="#5FAE4B"/>
    <path d="M38 124q20-22 40-6q18-10 28 8v14H38z" fill="${main}"/>`,
  sushi: ({ main }) => `
    <rect x="16" y="130" width="168" height="16" rx="8" fill="#B88A5A"/>
    <g><circle cx="58" cy="96" r="38" fill="#22262A"/><circle cx="58" cy="96" r="30" fill="#FFFFFF"/><circle cx="58" cy="96" r="13" fill="${main}"/></g>
    <g><circle cx="142" cy="96" r="38" fill="#22262A"/><circle cx="142" cy="96" r="30" fill="#FFFFFF"/><circle cx="142" cy="96" r="13" fill="#5FAE4B"/></g>
    <rect x="84" y="44" width="32" height="18" rx="9" fill="${main}"/><rect x="84" y="60" width="32" height="12" rx="6" fill="#FFFFFF" stroke="#E7DCCB" stroke-width="2"/>`,
  cake: ({ main, second }) => `
    <ellipse cx="100" cy="170" rx="80" ry="10" fill="#E7DCCB"/>
    <rect x="30" y="108" width="140" height="58" rx="10" fill="#F1D9B5"/><rect x="30" y="126" width="140" height="12" fill="${main}"/>
    <rect x="48" y="62" width="104" height="50" rx="10" fill="#F1D9B5"/>
    <path d="M48 72a10 10 0 0 1 10-10h84a10 10 0 0 1 10 10v8q-13 14-26 0t-26 0t-26 0t-26 0z" fill="${main}"/>
    <path d="M30 118a10 10 0 0 1 10-10h120a10 10 0 0 1 10 10v4q-17 14-35 0t-35 0t-35 0t-35 0z" fill="${main}"/>
    <circle cx="100" cy="50" r="12" fill="${second}"/><path d="M100 40q4-14 14-12" fill="none" stroke="#4E9A3B" stroke-width="3" stroke-linecap="round"/>`,
  jar: ({ main, second }) => `
    <rect x="60" y="24" width="80" height="24" rx="8" fill="${second}"/>
    <rect x="48" y="52" width="104" height="126" rx="20" fill="#FFFFFF" fill-opacity="0.75" stroke="#DCD3C4" stroke-width="3"/>
    <path d="M52 86h96v72a16 16 0 0 1-16 16H68a16 16 0 0 1-16-16z" fill="${main}"/>
    <rect x="62" y="104" width="76" height="40" rx="8" fill="#FFFFFF" fill-opacity="0.92"/><rect x="72" y="116" width="56" height="7" rx="3.5" fill="${second}"/><rect x="72" y="129" width="36" height="6" rx="3" fill="${main}" fill-opacity="0.6"/>`,
  tub: ({ main, second }) => `
    <rect x="50" y="22" width="100" height="30" rx="10" fill="#1F2328"/>
    <rect x="42" y="50" width="116" height="130" rx="18" fill="#2B3036"/>
    <rect x="42" y="82" width="116" height="68" fill="${main}"/>
    <path d="M70 100l14 30l12-20l10 14l12-24" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="62" y="158" width="76" height="7" rx="3.5" fill="${second}"/>`,
  cup: ({ main, second }) => `
    <path d="M112 12l-8 44" stroke="${second}" stroke-width="8" stroke-linecap="round"/>
    <path d="M46 56h108l-12 114a10 10 0 0 1-10 9H68a10 10 0 0 1-10-9z" fill="#FFFFFF" stroke="#E7DCCB" stroke-width="3"/>
    <path d="M54 86h92l-9 80a8 8 0 0 1-8 7H71a8 8 0 0 1-8-7z" fill="${main}"/>
    <path d="M42 56a58 26 0 0 1 116 0z" fill="#FFF8EC" stroke="#E7DCCB" stroke-width="3"/>
    <ellipse cx="82" cy="110" rx="7" ry="16" fill="#FFFFFF" fill-opacity="0.3"/>`,
  fries: ({ main }) => `
    <g fill="#F4C95D" stroke="#DDAA3A" stroke-width="2"><rect x="58" y="22" width="14" height="92" rx="4" transform="rotate(-10 65 68)"/><rect x="78" y="14" width="14" height="100" rx="4"/><rect x="98" y="20" width="14" height="94" rx="4" transform="rotate(6 105 67)"/><rect x="118" y="26" width="14" height="88" rx="4" transform="rotate(14 125 70)"/><rect x="68" y="34" width="14" height="80" rx="4" transform="rotate(-4 75 74)"/></g>
    <path d="M44 86h112l-14 86a10 10 0 0 1-10 8H68a10 10 0 0 1-10-8z" fill="${main}"/>
    <path d="M44 86q56 26 112 0v16q-56 24-112 0z" fill="#FFFFFF" fill-opacity="0.22"/><circle cx="100" cy="140" r="14" fill="#FFFFFF" fill-opacity="0.9"/>`,
  snack: ({ main }) => `
    <ellipse cx="100" cy="150" rx="84" ry="24" fill="#FFFFFF" stroke="#E7DCCB" stroke-width="3"/>
    <g fill="${main}" stroke="#B36A1E" stroke-width="2.5"><path d="M60 72q26 34 0 70q-26-36 0-70z"/><path d="M100 54q30 40 0 84q-30-44 0-84z"/><path d="M140 72q26 34 0 70q-26-36 0-70z"/></g>
    <g fill="#FFFFFF" fill-opacity="0.35"><ellipse cx="54" cy="110" rx="4" ry="9"/><ellipse cx="93" cy="100" rx="5" ry="11"/><ellipse cx="134" cy="110" rx="4" ry="9"/></g>`,
  dish: ({ main, second }) => `
    <ellipse cx="100" cy="124" rx="88" ry="50" fill="#FFFFFF" stroke="#E7DCCB" stroke-width="3"/><ellipse cx="100" cy="122" rx="66" ry="34" fill="#F6EFE3"/>
    <path d="M52 96h96v34a10 10 0 0 1-10 10H62a10 10 0 0 1-10-10z" fill="${main}"/>
    <path d="M52 96h96v10H52z" fill="${second}"/><path d="M52 116h96v6H52z" fill="#FBE7C2"/>
    <g fill="#4E9A3B"><circle cx="78" cy="94" r="4"/><circle cx="104" cy="92" r="4"/><circle cx="128" cy="95" r="4"/></g>`,
  bag: ({ main, second }) => `
    <path d="M56 46q44-22 88 0l14 118a12 12 0 0 1-12 14H54a12 12 0 0 1-12-14z" fill="${main}"/>
    <path d="M62 44q38-18 76 0l-8 14H70z" fill="${second}"/>
    <rect x="62" y="88" width="76" height="52" rx="10" fill="#FFFFFF" fill-opacity="0.9"/><path d="M82 126l10-22l8 14l8-10l10 18z" fill="${second}"/>`,
};

/** Palavras do nome do produto que decidem o desenho e as cores. A primeira regra que casa vale. */
const RULES: [RegExp, Drawing, string, string][] = [
  [/pizza|calabresa|mussarela/, "pizza", "#C8372D", "#3F6B2A"],
  [/batata frita|batata com|aneis|anéis/, "fries", "#C8372D", "#F4C95D"],
  [/burger|brasa|crispy|veggie|hamb/, "burger", "#F4C95D", "#6B3A1E"],
  [/acai|açaí|barca|cupuacu|cupuaçu/, "acai", "#D8412F", "#8B5A2B"],
  [/milkshake|suco|cafe com leite|café com leite|vitamina/, "cup", "#F59E0B", "#D8412F"],
  [/cerveja.*lata|lata/, "can", "#C8372D", "#F4C95D"],
  [/cerveja|long neck/, "bottle", "#B7791F", "#2F6B3A"],
  [/refrigerante/, "bottle", "#4A2A1A", "#C8372D"],
  [/agua de coco|água de coco/, "bottle", "#DDF2E3", "#2F6B3A"],
  [/agua|água/, "bottle", "#8FCBF0", "#1D4ED8"],
  [/energetico|energético/, "can", "#16A34A", "#111827"],
  [/gelo/, "bag", "#BFE3F7", "#1D4ED8"],
  [/carvao|carvão/, "bag", "#3A3A3A", "#C8372D"],
  [/lasanha|torta|cuscuz|tapioca|kit cafe|kit café/, "dish", "#C8372D", "#F4C95D"],
  [/quentinha|marmita|prato|frango guisado|carne de sol|feijoada|galinha|churrasco|peixe frito/, "lunchbox", "#B45309", "#5FAE4B"],
  [/sushi|combo \d+ pecas|combo \d+ peças|temaki|hot roll/, "sushi", "#F97316", "#5FAE4B"],
  [/tilapia|tilápia|sardinha|cavala|camarao|camarão|peixe|file de|filé de/, "fish", "#7A9BB5", "#4B6B85"],
  [/coxinha|risole|pastel|salgad|bolinha|enroladinho|espetinho/, "snack", "#E0A04A", "#B36A1E"],
  [/brigadeiro/, "snack", "#5B3A29", "#3B2413"],
  [/bolo|fatia|doce de/, "cake", "#7B4A2E", "#D8412F"],
  [/pao|pão/, "bread", "#E3A857", "#C9822F"],
  [/tomate|maca|maçã|morango/, "produce", "#D8412F", "#B02A1F"],
  [/cebola|beterraba|uva/, "produce", "#8E4585", "#B565A7"],
  [/banana|limao|limão|milho|abacaxi/, "produce", "#F4C95D", "#E0A52B"],
  [/batata|mandioca|inhame/, "produce", "#C9A26B", "#A67C45"],
  [/alface|couve|coentro|cheiro|pimentao|pimentão|laranja|cenoura/, "produce", "#5FAE4B", "#F59E0B"],
  [/frango|carne|linguica|linguiça|bandeja|charque|bacon/, "tray", "#D9737A", "#FFFFFF"],
  [/leite|iogurte|creme de leite/, "carton", "#2563EB", "#F59E0B"],
  [/manteiga|queijo|requeijao|requeijão|margarina/, "hygiene", "#F4C95D", "#F59E0B"],
  [/sabao|sabão|detergente|agua sanitaria|água sanitária|desinfetante|amaciante|alcool|álcool/, "cleaning", "#2563EB", "#F59E0B"],
  [/sabonete|creme dental|papel|desodorante|shampoo|absorvente|fralda|escova|fio dental|preservativo|protetor|repelente|curativo/, "hygiene", "#0F766E", "#F59E0B"],
  [/dipirona|paracetamol|antiacido|antiácido|soro|sais|termometro|termômetro|analges|comprimid/, "medicine", "#0F766E", "#D8412F"],
  [/whey|creatina|pre-treino|pré-treino/, "tub", "#D8412F", "#F4C95D"],
  [/barra de proteina|barra de proteína/, "package", "#7B4A2E", "#F4C95D"],
  [/coqueteleira/, "cup", "#1F2328", "#D8412F"],
  [/granola|castanha|amendoim|mix|mel|aveia|linhaca|linhaça|pasta de|cha|chá/, "jar", "#C68A3A", "#4D7C0F"],
  [/arroz|feijao|feijão|acucar|açúcar|cafe|café|flocao|flocão|macarrao|macarrão|sal |sal$|farinha|achocolatado|biscoito|oleo|óleo/, "package", "#15803D", "#F59E0B"],
];

const PACKAGE_COLORS = ["#15803D", "#B45309", "#1D4ED8", "#B91C1C", "#7C3AED", "#0F766E"];

/** As cores típicas de um desenho (as da primeira regra que o usa). */
function colorsOf(drawing: Drawing): Colors {
  const rule = RULES.find(([, ruleDrawing]) => ruleDrawing === drawing);
  return rule ? { main: rule[2], second: rule[3] } : { main: PACKAGE_COLORS[0], second: "#F59E0B" };
}

/** Escolhe o desenho e as cores de um produto pelo nome; sem regra, usa o desenho padrão da loja. */
function drawingFor(name: string, fallback: Drawing): { drawing: Drawing; colors: Colors } {
  if (name in DRAW) return { drawing: name as Drawing, colors: colorsOf(name as Drawing) };
  const plain = name.toLowerCase();
  const rule = RULES.find(([pattern]) => pattern.test(plain));
  if (!rule) {
    const main = PACKAGE_COLORS[hash(name) % PACKAGE_COLORS.length];
    return { drawing: fallback, colors: { main, second: mix(main, 0.45) } };
  }
  const [, drawing, main, second] = rule;
  // Pacotes e caixas do mesmo tipo variam de cor, para a prateleira não ficar toda igual.
  const varied = drawing === "package" || drawing === "hygiene" || drawing === "cleaning" || drawing === "carton";
  return { drawing, colors: { main: varied ? PACKAGE_COLORS[hash(name) % PACKAGE_COLORS.length] : main, second } };
}

/** Um desenho colocado com o centro em (x, y) e o tamanho informado. */
function place(drawing: Drawing, colors: Colors, x: number, y: number, size: number, rotate = 0): string {
  const scale = size / 200;
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${scale}) rotate(${rotate} 100 100)">${DRAW[drawing](colors)}</g>`;
}

// ------------------------------------------------------------------- imagens

/** Foto de produto: fundo claro com o tom da loja, uma "mesa" e o desenho no centro. */
function productSvg(name: string, art: Art, storeColor: string) {
  const { drawing, colors } = drawingFor(name, art);
  const light = mix(storeColor, 0.86);
  const lighter = mix(storeColor, 0.94);
  const tilt = (hash(name) % 9) - 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <defs><radialGradient id="glow" cx="50%" cy="42%" r="65%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${light}"/></radialGradient></defs>
    <rect width="800" height="800" fill="url(#glow)"/>
    <rect y="560" width="800" height="240" fill="${lighter}"/><rect y="556" width="800" height="6" fill="${mix(storeColor, 0.7)}" fill-opacity="0.5"/>
    <ellipse cx="400" cy="640" rx="250" ry="34" fill="${INK}" fill-opacity="0.12"/>
    ${place(drawing, colors, 400, 390, 520, tilt)}
  </svg>`;
}

/** Logo: círculo na cor da loja com o desenho do que ela vende e as iniciais. */
function logoSvg(storeName: string, color: string, product: { name: string; art: Art }) {
  const initials = storeName.split(" ").filter((word) => word.length > 2).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
  const { drawing, colors } = drawingFor(product.name, product.art);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <circle cx="200" cy="200" r="200" fill="${color}"/><circle cx="200" cy="170" r="128" fill="#FFFFFF" fill-opacity="0.94"/>
    ${place(drawing, colors, 200, 170, 190)}
    <text x="200" y="356" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" fill="#FFFFFF">${escapeXml(initials)}</text>
  </svg>`;
}

/** Faixa com desenhos espalhados sobre a cor informada. Serve para capas e banners. */
function sceneSvg(width: number, height: number, color: string, items: { name: string; art: Drawing }[], text?: { title: string; subtitle: string }) {
  const dark = mix(color, -0.25);
  // Com texto, os desenhos ficam menores e do lado direito; sem texto, ocupam a faixa toda.
  const size = Math.round(height * (text ? 0.46 : 0.58));
  const radius = size * 0.56;
  // Margem de 6% nas laterais: os banners e capas são mostrados com cantos arredondados,
  // e um desenho encostado na borda parece cortado.
  const margin = width * 0.06;
  const start = text ? width * 0.62 : radius + margin;
  const end = width - radius - margin;
  const step = (end - start) / Math.max(1, items.length - 1);
  const drawings = items.map((item, index) => {
    const { drawing, colors } = drawingFor(item.name, item.art);
    const x = items.length === 1 ? width / 2 : start + step * index;
    const y = height / 2 + (index % 2 === 0 ? -height * 0.04 : height * 0.06);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#FFFFFF" fill-opacity="0.92"/>${place(drawing, colors, x, y, size * 0.82, index % 2 === 0 ? -6 : 6)}`;
  });
  const dots: string[] = [];
  for (let x = 40; x < width; x += 90) for (let y = 30; y < height; y += 90) dots.push(`<circle cx="${x + ((y / 90) % 2) * 45}" cy="${y}" r="5" fill="#FFFFFF" fill-opacity="0.12"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#fade)"/>${dots.join("")}${drawings.join("")}
    ${text ? `<g font-family="Arial, Helvetica, sans-serif" fill="#FFFFFF">
      ${wrap(text.title, 16, 3).map((line, index) => `<text x="64" y="${height / 2 - 50 + index * 68}" font-size="58" font-weight="700">${escapeXml(line)}</text>`).join("")}
      <text x="64" y="${height / 2 - 50 + wrap(text.title, 16, 3).length * 68 + 6}" font-size="34">${escapeXml(text.subtitle)}</text>
    </g>` : ""}
  </svg>`;
}

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
  return lines.slice(0, maxLines);
}

/** Imagem do segmento: três desenhos do que se encontra nele, sobre o tom da categoria. */
function categorySvg(slug: string, color: string) {
  const arts = CATEGORY_ARTS[slug] ?? ["grocery", "package", "bag"];
  const pick = colorsOf;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" rx="72" fill="${mix(color, 0.84)}"/><circle cx="200" cy="210" r="150" fill="#FFFFFF" fill-opacity="0.75"/>
    ${place(arts[1], pick(arts[1]), 118, 236, 170, -8)}${place(arts[2], pick(arts[2]), 286, 240, 170, 8)}${place(arts[0], pick(arts[0]), 200, 172, 230)}
  </svg>`;
}

/** Grava uma foto (arquivo ou imagem em memória) no tamanho pedido, cortando para preencher. */
async function writePhoto(path: string, source: string | Buffer, width: number, height: number, force: boolean) {
  const file = join(STORAGE, path);
  if (!force && existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  await sharp(source).resize(width, height, { fit: "cover" }).webp({ quality: 74, effort: 4 }).toFile(file);
  return true;
}

/** Três fotos lado a lado: a capa da loja feita com os produtos dela. */
async function collage(photos: string[], width: number, height: number): Promise<Buffer> {
  const tile = Math.ceil(width / photos.length);
  const tiles = await Promise.all(photos.map((photo) => sharp(photo).resize(tile, height, { fit: "cover" }).toBuffer()));
  return sharp({ create: { width, height, channels: 3, background: "#FFF8F1" } })
    .composite(tiles.map((input, index) => ({ input, left: index * tile, top: 0 })))
    .webp({ quality: 92 })
    .toBuffer();
}

async function write(path: string, svg: string, width: number, height: number, force: boolean) {
  const file = join(STORAGE, path);
  if (!force && existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  // Desenhos chapados comprimem muito bem: qualidade 72 fica leve e sem perda visível.
  await sharp(Buffer.from(svg)).resize(width, height).webp({ quality: 72, effort: 5 }).toFile(file);
  return true;
}

/**
 * Grava todas as fotos do seed em storage/. Arquivos que já existem são mantidos, a não ser com `force`.
 * Com `categoriesOnly` (seed de produção) grava só as imagens dos segmentos.
 */
export async function generateImages({ force = false, categoriesOnly = false } = {}) {
  const jobs: Promise<boolean>[] = [];

  for (const store of categoriesOnly ? [] : STORES) {
    const shown = store.products.filter((product) => !product.noImage);
    const main = shown[0] ?? store.products[0];
    // A capa mostra produtos bem diferentes entre si, quando a loja tem variedade.
    const variety = new Map<Drawing, { name: string; art: Art }>();
    for (const product of shown) {
      const { drawing } = drawingFor(product.name, product.art);
      if (!variety.has(drawing)) variety.set(drawing, { name: product.name, art: product.art });
    }
    // Loja com pouca variedade (só açaí, só pizza) completa a capa com os desenhos do segmento.
    for (const drawing of CATEGORY_ARTS[store.category] ?? []) {
      if (variety.size >= 4) break;
      if (!variety.has(drawing)) variety.set(drawing, { name: drawing, art: "grocery" });
    }
    const cover = [...variety.values()].slice(0, 4);

    jobs.push(write(`stores/${store.slug}-logo.webp`, logoSvg(store.name, store.color, main ?? { name: store.name, art: "grocery" }), 400, 400, force));
    const logo = logoSvg(store.name, store.color, main ?? { name: store.name, art: "grocery" });
    const coverSvg = sceneSvg(1200, 400, store.color, cover.length > 0 ? cover : [{ name: store.name, art: "grocery" }]);
    // Versões pequenas, que o celular baixa no lugar das grandes.
    jobs.push(write(`stores/${store.slug}-logo-small.webp`, logo, 192, 192, force));
    // Com fotos de IA de pelo menos três produtos diferentes, a capa é uma montagem delas; senão, o desenho.
    const photos = [...new Set([...cover, ...shown].map((item) => photoFile(item.name)))].filter((photo) => existsSync(photo)).slice(0, 3);
    if (photos.length === 3) {
      jobs.push(collage(photos, 1200, 400).then(async (image) => {
        const big = await writePhoto(`stores/${store.slug}-cover.webp`, image, 1200, 400, force);
        const small = await writePhoto(`stores/${store.slug}-cover-small.webp`, image, 600, 200, force);
        return big || small;
      }));
    } else {
      jobs.push(write(`stores/${store.slug}-cover.webp`, coverSvg, 1200, 400, force));
      jobs.push(write(`stores/${store.slug}-cover-small.webp`, coverSvg, 600, 200, force));
    }

    for (const product of shown) {
      const base = `products/${store.slug}/${slugify(product.name)}`;
      // A foto gerada por IA, quando existe; senão, o desenho.
      const photo = photoFile(product.name);
      if (existsSync(photo)) {
        jobs.push(writePhoto(`${base}-800.webp`, photo, 800, 800, force));
        jobs.push(writePhoto(`${base}-400.webp`, photo, 400, 400, force));
        continue;
      }
      const svg = productSvg(product.name, product.art, store.color);
      jobs.push(write(`${base}-800.webp`, svg, 800, 800, force));
      jobs.push(write(`${base}-400.webp`, svg, 400, 400, force));
    }
  }

  for (const banner of categoriesOnly ? [] : BANNERS) {
    const items = banner.arts.map((art) => ({ name: art, art: art as Drawing }));
    const svg = sceneSvg(1200, 500, banner.color, items, { title: banner.title, subtitle: banner.subtitle });
    jobs.push(write(`banners/${banner.key}.webp`, svg, 1200, 500, force));
    jobs.push(write(`banners/${banner.key}-small.webp`, svg, 600, 250, force));
  }

  for (const category of CATEGORIES) {
    if (!(category.slug in CATEGORY_ARTS)) continue;
    jobs.push(write(`categories/${category.slug}.webp`, categorySvg(category.slug, CATEGORY_COLORS[category.slug] ?? "#E8611A"), 240, 240, force));
  }

  const written = (await Promise.all(jobs)).filter(Boolean).length;
  return { total: jobs.length, written };
}

// `npm run seed:images` gera tudo de novo.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await generateImages({ force: true });
  console.log(`${result.written} imagens geradas em storage/.`);
}
