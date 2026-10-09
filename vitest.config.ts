import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Unit tests live next to the code. Integration tests run against the
    // test database, recreated with the seed before each run.
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/reset-test-db.ts"],
  },
});
