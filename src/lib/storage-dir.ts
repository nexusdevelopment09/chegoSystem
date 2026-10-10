import { resolve } from "node:path";

/**
 * A pasta onde ficam as fotos (enviadas e as do seed). Os testes automáticos
 * usam outra pasta (STORAGE_DIR), para não misturar as fotos deles com as que
 * você enviou testando à mão.
 */
export const STORAGE_DIR = resolve(process.cwd(), process.env.STORAGE_DIR ?? "storage");
