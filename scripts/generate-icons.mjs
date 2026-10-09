// Generates the PWA icons in public/icons from the logo drawing.
// Run with: npm run icons   (only needed when the logo changes)
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = new URL("../public/icons/", import.meta.url);

const bag = `
  <path d="M37 40V28a13 13 0 0 1 26 0v12" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M25 38h50l-3.5 41a5 5 0 0 1-5 4.6h-33a5 5 0 0 1-5-4.6z" fill="#FFFFFF"/>
  <circle cx="41.5" cy="53" r="4.2" fill="#E8611A"/>
  <circle cx="58.5" cy="53" r="4.2" fill="#E8611A"/>
  <path d="M38.5 64q11.5 11 23 0" fill="none" stroke="#E8611A" stroke-width="5.5" stroke-linecap="round"/>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="28" fill="#E8611A"/>${bag}</svg>`;

// Maskable and Apple icons are cropped by the system, so they fill the whole
// square and keep the bag inside the central safe area.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#E8611A"/><g transform="translate(12.5 12.5) scale(0.75)">${bag}</g></svg>`;

const png = (svg, size) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer();

await mkdir(OUT, { recursive: true });
await writeFile(new URL("icon.svg", OUT), rounded);
await writeFile(new URL("icon-192.png", OUT), await png(rounded, 192));
await writeFile(new URL("icon-512.png", OUT), await png(rounded, 512));
await writeFile(new URL("icon-maskable-512.png", OUT), await png(fullBleed, 512));
await writeFile(new URL("apple-touch-icon.png", OUT), await png(fullBleed, 180));

console.log("Icons written to public/icons");
