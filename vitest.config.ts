import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Os testes unitários ficam ao lado do código. Os de integração rodam contra o
    // banco de teste, recriado com o seed antes de cada execução.
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/reset-test-db.ts"],
  },
});
