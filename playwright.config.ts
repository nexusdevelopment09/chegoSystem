import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the dev server and the local database.
// The database must be on (`npm run db:start`) before running them.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    trace: "retain-on-failure",
  },
  projects: [{ name: "celular", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
