import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Serve as fotos da pasta local storage/ (buckets: products, stores,
// banners). Faz o papel de um armazenamento de arquivos na nuvem no ambiente de testes.
const STORAGE = join(process.cwd(), "storage");
const BUCKETS = new Set(["products", "stores", "banners"]);
const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const contentType = CONTENT_TYPES[path.at(-1)?.split(".").pop()?.toLowerCase() ?? ""];

  // Só buckets conhecidos e nomes de arquivo simples: nunca "..", nunca caminhos absolutos.
  if (!contentType || !BUCKETS.has(path[0]) || !path.every((segment) => SAFE_SEGMENT.test(segment))) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(join(STORAGE, ...path));
    return new Response(new Uint8Array(file), {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
