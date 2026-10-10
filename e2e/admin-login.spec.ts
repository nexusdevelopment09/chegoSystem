import { expect, test } from "@playwright/test";
import { freshDatabase } from "./helpers";

test.beforeAll(() => freshDatabase());

test("a página inicial mostra a marca e a faixa de testes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Ambiente de testes")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pediu, Chegô." })).toBeVisible();
});

test("o painel do admin exige login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("senha errada não entra", async ({ page }) => {
  await page.goto("/entrar/senha");
  await page.getByLabel("Usuário ou e-mail").fill("admin");
  await page.getByLabel("Senha").fill("errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Usuário ou senha incorretos.")).toBeVisible();
});

test("admin entra, vê o painel e sai", async ({ page }) => {
  await page.goto("/entrar/senha");
  await page.getByLabel("Usuário ou e-mail").fill("admin");
  await page.getByLabel("Senha").fill("admin");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Oi, Admin Chegô!" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/entrar$/);
});
