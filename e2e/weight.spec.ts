import { expect, test } from "@playwright/test";
import { chooseNeighborhood, db, freshDatabase, loginAs, productUrl, setClock, visible } from "./helpers";

// Uma sexta às 15h: o Empório Vida Verde está aberto.
test.beforeAll(() => freshDatabase("2026-10-09T15:00"));
test.afterAll(() => setClock(null));

test("cliente digita quantos gramas quer (410 g) e paga pelo preço do quilo; a loja vê o peso", async ({ page, browser }) => {
  await db`delete from carts`;
  await loginAs(page, "Ana Clara Souza");
  await page.evaluate(() => window.localStorage.clear());
  await chooseNeighborhood(page, "Centro");

  // A granel vem primeiro no cardápio, com o preço do quilo.
  await page.goto("/loja/emporio-vida-verde");
  await expect(page.getByRole("heading", { name: "A granel (por peso)" })).toBeVisible();
  await expect(page.locator("li", { hasText: "Granola a granel" }).first()).toContainText("R$ 39,90/kg");

  await page.goto(await productUrl("emporio-vida-verde", "Granola a granel"));
  await expect(visible(page, "weight-price")).toContainText("R$ 39,90 o kg · mínimo 100 g, de 10 em 10 g");
  const grams = visible(page, "grams");
  await expect(grams).toHaveValue("100");
  await expect(page.getByRole("button", { name: /^Adicionar • R\$ 3,99$/ })).toBeVisible();

  // Abaixo do mínimo não deixa adicionar.
  await grams.fill("95");
  await expect(visible(page, "disabled-reason")).toHaveText("O mínimo é 100 g.");
  // Fora da precisão da loja também não.
  await grams.fill("415");
  await expect(visible(page, "disabled-reason")).toHaveText("Escolha de 10 em 10 g.");
  // 110 g sai pelo preço do quilo: 39,90 × 0,11 = 4,389 -> R$ 4,39.
  await grams.fill("110");
  await expect(page.getByRole("button", { name: /^Adicionar • R\$ 4,39$/ })).toBeVisible();
  // Os botões andam de 50 em 50 g.
  await page.getByRole("button", { name: "Mais 50 g" }).click();
  await expect(grams).toHaveValue("160");

  // O pedido mínimo do Empório é R$ 15,00: 410 g = R$ 16,36.
  await grams.fill("410");
  await page.getByRole("button", { name: /^Adicionar • R\$ 16,36$/ }).click();
  await page.waitForURL(/\/loja\/emporio-vida-verde$/);

  await page.goto("/carrinho");
  await expect(visible(page, "cart-quantity")).toHaveText("410 g");
  await expect(visible(page, "cart-item")).toContainText("R$ 16,36");
  await page.getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByText("410 g Granola a granel")).toBeVisible();
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]+$/);
  const orderId = page.url().match(/pedidos\/([0-9a-f-]+)$/)![1];
  await expect(page.getByText("410 g Granola a granel")).toBeVisible();

  const [item] = await db`select quantity, line_total_cents, weight_step_grams from order_items where order_id = ${orderId}`;
  expect(item).toEqual({ quantity: 41, line_total_cents: 1636, weight_step_grams: 10 });

  const store = await (await browser.newContext()).newPage();
  await loginAs(store, "Larissa Pontes");
  await store.goto(`/lojista/pedidos/${orderId}`);
  await expect(store.locator('[data-testid="merchant-item"]:visible')).toContainText("410 g Granola a granel");
  await store.context().close();
});

test("a loja cadastra um produto por peso: preço do kg, precisão, mínimo e estoque em gramas", async ({ page }) => {
  await loginAs(page, "Larissa Pontes");
  await page.goto("/lojista/cardapio/produto/novo");
  await page.getByLabel("Nome").fill("Amendoim japonês a granel");
  await page.getByRole("radio", { name: /Por peso/ }).check();
  await page.getByLabel("Por peso: precisão").selectOption("250");
  await page.getByLabel("Por peso: pedido mínimo (g)").fill("300");
  await page.getByLabel("Preço (R$)").fill("20,00");
  await page.getByLabel("Controlar estoque (esgota sozinho ao zerar)").check();
  await page.getByLabel("Estoque", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Criar produto" }).click();
  // O mínimo precisa ser múltiplo da precisão.
  await expect(page.getByText("O mínimo em gramas precisa ser múltiplo de 250 g (e pelo menos 250 g).")).toBeVisible();
  await page.getByLabel("Por peso: pedido mínimo (g)").fill("500");
  await page.getByRole("button", { name: "Criar produto" }).click();

  // Criado, abre a página de edição do produto, já como "por peso".
  await page.waitForURL(/\/lojista\/cardapio\/produto\/[0-9a-f-]+$/);
  await expect(page.getByLabel("Preço do kg (R$)")).toHaveValue("20,00");
  await expect(page.getByLabel("Estoque (g)")).toHaveValue("5000");

  const [product] = await db`
    select price_cents, price_per_kg_cents, weight_step_grams, weight_min_grams, stock_qty from products where name = 'Amendoim japonês a granel'`;
  // R$ 20,00 o kg, precisão de 250 g (R$ 5,00 cada passo), mínimo 500 g; 5 kg = 20 passos.
  expect(product).toEqual({ price_cents: 500, price_per_kg_cents: 2000, weight_step_grams: 250, weight_min_grams: 500, stock_qty: 20 });

  await page.goto("/lojista/cardapio");
  const row = page.locator("li", { hasText: "Amendoim japonês a granel" }).first();
  await expect(row).toContainText("R$ 20,00/kg");
  await expect(row).toContainText("estoque 5 kg");
});
