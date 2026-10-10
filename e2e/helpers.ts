import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE, TEST_DATABASE_URL, TEST_STORAGE } from "../tests/reset-test-db";

/** Acesso direto ao banco de teste, para preparar ou conferir um cenário. */
export const db = postgres(TEST_DATABASE_URL, { max: 2, onnotice: () => {} });

/** Entra pelo login rápido da página /dev. */
export async function loginAs(page: Page, fullName: string) {
  await page.goto("/dev");
  await page.getByRole("button", { name: `Entrar como ${fullName}`, exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/dev"));
}

/** Entra como um usuário de verdade: número de telefone e o código fixo de teste. */
export async function loginWithPhone(page: Page, phone: string, code = "123456") {
  await page.goto("/entrar");
  await page.getByLabel("Seu telefone com DDD").fill(phone);
  await page.getByRole("button", { name: "Receber código" }).click();
  await page.getByLabel("Código de 6 números").fill(code);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

/** Move o relógio do sistema (horário de Maceió, ex.: "2026-10-09T11:30"), ou volta ao horário real com null. */
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

/** Endereço da página de um produto, achado pelo slug da loja e pelo nome do produto. */
export async function productUrl(storeSlug: string, productName: string) {
  const [row] = await db`
    select p.id from products p join stores s on s.id = p.store_id
    where s.slug = ${storeSlug} and p.name = ${productName}`;
  if (!row) throw new Error(`Produto não encontrado: ${productName}`);
  return `/loja/${storeSlug}/produto/${row.id}`;
}

/** Passo da primeira visita: diz ao app em que bairro o cliente está. */
export async function chooseNeighborhood(page: Page, name: string) {
  await page.goto("/boas-vindas");
  await page.getByLabel("Seu bairro ou comunidade").selectOption({ label: name });
  await page.getByRole("button", { name: "Ver as lojas" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Só o que está na tela: o Next mantém a página anterior montada, mas escondida. */
export const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);

/** Adiciona um produto que não precisa de escolhas e volta para a página da loja. */
export async function addSimple(page: Page, storeSlug: string, product: string) {
  await page.goto(await productUrl(storeSlug, product));
  await page.getByRole("button", { name: /^Adicionar/ }).click();
  await page.waitForURL(new RegExp(`/loja/${storeSlug}$`));
}

/**
 * Um cliente pede os produtos simples informados e o pagamento é aprovado.
 * Devolve o id do pedido. O cliente já precisa ter um endereço.
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
 * Recria o banco de teste com o seed original e acerta o relógio.
 * Cada arquivo de teste começa com isso, para nenhum depender do que outro alterou.
 */
export async function freshDatabase(localDateTime: string | null = null) {
  execFileSync(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: TEST_DATABASE, STORAGE_DIR: TEST_STORAGE }, stdio: "ignore" });
  // Recriar o banco derruba todas as conexões abertas (as nossas e as do app):
  // dá um instante para elas perceberem e espera até uma consulta passar de novo.
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
