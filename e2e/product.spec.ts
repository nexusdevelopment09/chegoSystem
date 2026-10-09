import { expect, test } from "@playwright/test";
import { db, productUrl, setClock } from "./helpers";

test.afterAll(async () => {
  await setClock(null);
  await db.end();
});

const addButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Adicionar/ });

test("montador de pizza: sabores, desenho, borda e preço pelo maior valor", async ({ page }) => {
  await page.goto(await productUrl("pizzaria-forno-de-barro", "Pizza Grande (8 fatias)"));
  await expect(page.getByRole("heading", { name: "Pizza Grande (8 fatias)" })).toBeVisible();
  await expect(page.getByText("A partir de R$ 45,00")).toBeVisible();
  await expect(page.getByText("Com mais de um sabor, cobramos o valor do sabor mais caro.")).toBeVisible();

  // Nothing chosen yet: the button explains what is missing.
  await expect(addButton(page)).toBeDisabled();
  await expect(page.getByTestId("disabled-reason")).toHaveText("Escolha pelo menos 1 em “Sabores”");
  await expect(page.getByTestId("pizza-caption")).toHaveText("Escolha até 2 sabores");

  await page.getByRole("checkbox", { name: "Calabresa", exact: true }).click();
  await expect(page.getByTestId("pizza-caption")).toHaveText("1 de 2 sabores");
  await expect(addButton(page)).toHaveText("Adicionar • R$ 45,00");

  await page.getByRole("checkbox", { name: "Carne de Sol com Queijo Coalho" }).click();
  await expect(page.getByTestId("pizza-caption")).toHaveText("2 de 2 sabores");
  await expect(page.getByTestId("pizza-preview")).toHaveAttribute(
    "aria-label", "Pizza com 2 sabores: Calabresa, Carne de Sol com Queijo Coalho.",
  );
  await expect(addButton(page)).toHaveText("Adicionar • R$ 56,00");

  // Two flavors is the limit for the large pizza, and Camarão is sold out.
  await expect(page.getByRole("checkbox", { name: "Mussarela" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Camarão" })).toBeDisabled();

  await page.getByRole("radio", { name: "Catupiry" }).click();
  await expect(addButton(page)).toHaveText("Adicionar • R$ 64,00");

  await page.getByLabel("Alguma observação?").fill("sem cebola");
  await page.getByRole("button", { name: "Aumentar quantidade" }).click();
  await expect(addButton(page)).toHaveText("Adicionar • R$ 128,00");

  await addButton(page).click();
  await expect(page).toHaveURL(/\/loja\/pizzaria-forno-de-barro$/);

  const cart = await page.evaluate(() => JSON.parse(window.localStorage.getItem("chego_cart")!));
  expect(cart.storeName).toBe("Pizzaria Forno de Barro");
  expect(cart.items[0]).toMatchObject({
    name: "Pizza Grande (8 fatias)", quantity: 2, unitPriceCents: 6400, notes: "sem cebola",
    lines: ["1/2 Calabresa", "1/2 Carne de Sol com Queijo Coalho", "Borda: Catupiry"],
  });
});

test("açaí: quatro complementos grátis e o quinto pago", async ({ page }) => {
  await page.goto(await productUrl("acai-tropical", "Açaí 500 ml"));
  await page.getByRole("radio", { name: "Açaí puro" }).click();
  await page.getByRole("radio", { name: "Por cima" }).click();
  for (const name of ["Granola", "Leite em pó", "Banana", "Paçoca"]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  await expect(addButton(page)).toHaveText("Adicionar • R$ 16,00");
  await page.getByRole("checkbox", { name: "Amendoim" }).click();
  await expect(addButton(page)).toHaveText("Adicionar • R$ 17,00");
});

test("item de outra loja pergunta se quer esvaziar o carrinho", async ({ page }) => {
  await page.goto(await productUrl("padaria-pao-quentinho", "Pão doce"));
  await addButton(page).click();
  await expect(page).toHaveURL(/\/loja\/padaria-pao-quentinho$/);

  await page.goto(await productUrl("brasa-burger", "Batata frita"));
  await addButton(page).click();
  await expect(page.getByText("Seu carrinho tem itens da Padaria Pão Quentinho. Quer esvaziar e começar um novo?")).toBeVisible();

  await page.getByRole("button", { name: "Manter meu carrinho" }).click();
  let cart = await page.evaluate(() => JSON.parse(window.localStorage.getItem("chego_cart")!));
  expect(cart.storeName).toBe("Padaria Pão Quentinho");

  await addButton(page).click();
  await page.getByRole("button", { name: "Esvaziar e adicionar" }).click();
  await expect(page).toHaveURL(/\/loja\/brasa-burger$/);
  cart = await page.evaluate(() => JSON.parse(window.localStorage.getItem("chego_cart")!));
  expect(cart.storeName).toBe("Brasa Burger");
  expect(cart.items).toHaveLength(1);
});

test("item de café da manhã só pode ser pedido até 10h", async ({ page }) => {
  const url = await productUrl("padaria-pao-quentinho", "Cuscuz com ovo");

  await setClock("2026-10-09T09:00");
  await page.goto(url);
  await expect(addButton(page)).toBeEnabled();

  await setClock("2026-10-09T10:30");
  await page.goto(url);
  await expect(addButton(page)).toBeDisabled();
  await expect(page.getByTestId("disabled-reason")).toHaveText("Só até 10h");
});

test("produto esgotado, encomenda e bebida alcoólica mostram seus avisos", async ({ page }) => {
  await page.goto(await productUrl("mercado-boa-compra", "Mamão unidade"));
  await expect(page.getByTestId("disabled-reason")).toHaveText("Esgotado");

  await page.goto(await productUrl("delicias-da-vo", "Cento de salgadinhos"));
  await expect(page.getByText("Encomenda com 24 horas de antecedência")).toBeVisible();

  await page.goto(await productUrl("deposito-gelada-ja", "Cerveja long neck 330 ml"));
  await expect(page.getByText("Venda só para maiores de 18 anos.")).toBeVisible();
});
