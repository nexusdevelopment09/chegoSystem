import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Unit tests live next to the code; integration tests need the local
    // database running (`npm run db:start`).
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
