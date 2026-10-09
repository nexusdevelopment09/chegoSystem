import { execFileSync } from "node:child_process";

export const TEST_DATABASE = "chego_test";
export const TEST_DATABASE_URL = `postgres://chego@127.0.0.1:54329/${TEST_DATABASE}`;

/**
 * Global setup for Vitest and Playwright: recreates the test database with
 * the full seed, starting the database server if it is off. The database you
 * use by hand (`chego`) is never touched.
 */
export default function resetTestDatabase() {
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], {
    env: { ...process.env, CHEGO_DB: TEST_DATABASE },
    stdio: "inherit",
  });
}
