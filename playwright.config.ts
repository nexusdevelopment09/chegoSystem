import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "./tests/reset-test-db";

// Os testes de ponta a ponta sobem a própria cópia do app na porta 3100, ligada
// ao banco de teste, então nunca mexem nos dados que você está testando à mão.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./tests/reset-test-db.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // O servidor de desenvolvimento compila cada página na primeira visita, o que pode levar alguns segundos.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    trace: "retain-on-failure",
  },
  projects: [{ name: "celular", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // Liga o banco antes (não faz nada se já estiver ligado); sem ele o app só mostra "banco desligado".
    command: `node scripts/db.ts start && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, NEXT_DIST_DIR: ".next-e2e", DISABLE_TASK_RUNNER: "1" },
  },
});
