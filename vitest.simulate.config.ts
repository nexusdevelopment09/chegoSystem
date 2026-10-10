import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL, TEST_STORAGE } from "./tests/reset-test-db.ts";

// Simulação de pedidos em todas as lojas (`npm run simulate`).
// Por padrão roda no banco que você usa à mão, para os pedidos aparecerem nas telas.
// Com `--mode test-db` (usado pelo `npm run test:all`) roda no banco de teste, recriado antes.
export default defineConfig(({ mode }) => {
  const onTestDatabase = mode === "test-db";
  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      },
    },
    test: {
      include: ["tests/simulation/**/*.test.ts"],
      globalSetup: onTestDatabase ? ["tests/reset-test-db.ts"] : [],
      env: {
        DATABASE_URL: onTestDatabase ? TEST_DATABASE_URL : process.env.DATABASE_URL ?? "postgres://chego@127.0.0.1:54329/chego",
        APP_ENV: "local",
        PAYMENT_PROVIDER: "mock",
        ...(onTestDatabase ? { STORAGE_DIR: TEST_STORAGE } : {}),
      },
      testTimeout: 120_000,
      // A tabela do resultado é impressa sempre, e não só quando algo falha.
      silent: false,
      reporters: ["verbose"],
    },
  };
});
