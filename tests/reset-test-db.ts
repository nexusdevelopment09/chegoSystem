import { execFileSync } from "node:child_process";

export const TEST_DATABASE = "chego_test";
export const TEST_DATABASE_URL = `postgres://chego@127.0.0.1:54329/${TEST_DATABASE}`;

/**
 * Preparação global do Vitest e do Playwright: recria o banco de teste com
 * o seed completo, ligando o servidor do banco se estiver desligado. O banco que
 * você usa à mão (`chego`) nunca é tocado.
 */
export default function resetTestDatabase() {
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], {
    env: { ...process.env, CHEGO_DB: TEST_DATABASE },
    stdio: "inherit",
  });
}
