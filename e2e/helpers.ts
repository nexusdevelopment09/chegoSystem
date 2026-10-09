import type { Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../tests/reset-test-db";

/** Direct access to the test database, to prepare or check a scenario. */
export const db = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });

/** Signs in through the quick login of the /dev page. */
export async function loginAs(page: Page, fullName: string) {
  await page.goto("/dev");
  await page.getByRole("button", { name: `Entrar como ${fullName}`, exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/dev"));
}

/** Signs in the way a real user does: phone number and the fixed test code. */
export async function loginWithPhone(page: Page, phone: string, code = "123456") {
  await page.goto("/entrar");
  await page.getByLabel("Seu telefone com DDD").fill(phone);
  await page.getByRole("button", { name: "Receber código" }).click();
  await page.getByLabel("Código de 6 números").fill(code);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
