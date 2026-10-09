import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Serves pictures from the local storage/ folder (buckets: products, stores,
// banners). This replaces a cloud file storage in the test environment.
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

  // Only known buckets and plain file names: never "..", never absolute paths.
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
