import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE, TEST_DATABASE_URL } from "../tests/reset-test-db";

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

/** Moves the system clock (Maceió time, e.g. "2026-10-09T11:30"), or back to real time with null. */
export async function setClock(localDateTime: string | null) {
  if (localDateTime === null) {
    await db`delete from platform_settings where key = 'dev_clock_offset_ms'`;
    return;
  }
  const offset = new Date(`${localDateTime}:00-03:00`).getTime() - Date.now();
  await db`
    insert into platform_settings (key, value) values ('dev_clock_offset_ms', ${db.json(offset)})
    on conflict (key) do update set value = excluded.value`;
}

/** Address of a product page, found by store slug and product name. */
export async function productUrl(storeSlug: string, productName: string) {
  const [row] = await db`
    select p.id from products p join stores s on s.id = p.store_id
    where s.slug = ${storeSlug} and p.name = ${productName}`;
  if (!row) throw new Error(`Produto não encontrado: ${productName}`);
  return `/loja/${storeSlug}/produto/${row.id}`;
}

/** First-visit step: tells the app which neighborhood the customer is in. */
export async function chooseNeighborhood(page: Page, name: string) {
  await page.goto("/boas-vindas");
  await page.getByLabel("Seu bairro ou comunidade").selectOption({ label: name });
  await page.getByRole("button", { name: "Ver as lojas" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Only what is on screen: Next keeps the previous page mounted but hidden. */
export const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);

/** Adds a product that needs no choices and lands back on the store page. */
export async function addSimple(page: Page, storeSlug: string, product: string) {
  await page.goto(await productUrl(storeSlug, product));
  await page.getByRole("button", { name: /^Adicionar/ }).click();
  await page.waitForURL(new RegExp(`/loja/${storeSlug}$`));
}

/**
 * A customer orders the given simple products and the payment is approved.
 * Returns the order id. The customer must already have an address.
 */
export async function placePaidOrder(page: Page, customer: string, storeSlug: string, products: string[], beforeSubmit?: () => Promise<void>) {
  await db`delete from carts`;
  await loginAs(page, customer);
  await page.evaluate(() => window.localStorage.clear());
  for (const product of products) await addSimple(page, storeSlug, product);
  await page.goto("/checkout");
  if (beforeSubmit) await beforeSubmit();
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]+\/pagamento$/);
  const orderId = page.url().match(/pedidos\/([0-9a-f-]+)\//)![1];
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await page.waitForURL(new RegExp(`/pedidos/${orderId}$`));
  return orderId;
}

/**
 * Recreates the test database with the original seed and sets the clock.
 * Each test file starts with it, so no file depends on what another one changed.
 */
export async function freshDatabase(localDateTime: string | null = null) {
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE }, stdio: "ignore" });
  // Recreating the database drops every open connection (ours and the app's):
  // give them a moment to notice, then wait until a query goes through again.
  for (let attempt = 0; ; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await db`select 1`;
      break;
    } catch (error) {
      if (attempt >= 10) throw error;
    }
  }
  await setClock(localDateTime);
}
