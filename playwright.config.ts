import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "./tests/reset-test-db";

// End-to-end tests start their own copy of the app on port 3100, connected to
// the test database, so they never touch the data you are testing by hand.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./tests/reset-test-db.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // The dev server compiles each page on its first visit, which can take a few seconds.
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
    // Starts the database first (does nothing if it is already on); without it the app only shows "banco desligado".
    command: `node scripts/db.ts start && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, NEXT_DIST_DIR: ".next-e2e", DISABLE_TASK_RUNNER: "1" },
  },
});
