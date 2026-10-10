import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/reset-test-db.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Os testes unitários ficam ao lado do código. Os de integração rodam contra o
    // banco de teste, recriado com o seed antes de cada execução.
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/reset-test-db.ts"],
    // O código do app chamado pelos testes de integração lê o banco destas variáveis.
    env: { DATABASE_URL: TEST_DATABASE_URL, APP_ENV: "local", PAYMENT_PROVIDER: "mock" },
    // Um arquivo por vez: os de integração dividem o mesmo banco, e o de pagamentos
    // grava pedidos de verdade (depois devolve o banco ao estado do seed).
    fileParallelism: false,
  },
});
