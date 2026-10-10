import { expect, test } from "@playwright/test";
import { freshDatabase } from "./helpers";

test.beforeAll(() => freshDatabase());

test("login rápido entra como cliente e como admin", async ({ page }) => {
  await page.goto("/dev");
  await page.getByRole("button", { name: "Entrar como Ana Clara Souza" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Um cliente não entra no painel do admin.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/dev");
  await page.getByRole("button", { name: "Entrar como Admin Chegô" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Oi, Admin Chegô!" })).toBeVisible();
});

test("a lista de login mostra o papel na loja e o cliente bloqueado", async ({ page }) => {
  await page.goto("/dev");
  await expect(page.getByText("Pizzaria Forno de Barro (entregador)")).toBeVisible();
  await expect(page.getByText("Mercado Boa Compra (atendente)")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Henrique Costa" })).toContainText("bloqueado");
});

test("relógio simulado muda a hora do sistema e volta ao normal", async ({ page }) => {
  await page.goto("/dev");
  await expect(page.getByText("(horário real)")).toBeVisible();

  await page.getByLabel("Nova data e hora").fill("2026-12-25T10:30");
  await page.getByRole("button", { name: "Definir" }).click();
  await expect(page.getByTestId("clock-now")).toHaveText("25/12/2026, 10:30");
  await expect(page.getByText("simulado", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Voltar ao horário real" }).click();
  await expect(page.getByText("(horário real)")).toBeVisible();
});

test("pagamento pendente pode ser recusado e depois aprovado", async ({ page }) => {
  await page.goto("/dev");
  const pending = page.getByTestId("pending-payment").filter({ hasText: "Eduarda Santos" });
  await expect(pending).toHaveCount(1);

  await pending.getByRole("button", { name: "Recusar" }).click();
  await expect(pending).toContainText("recusado");

  await pending.getByRole("button", { name: "Aprovar" }).click();
  await expect(pending).toHaveCount(0);
});

test("a caixa de mensagens mostra o que o sistema enviou", async ({ page }) => {
  await page.goto("/dev");
  await expect(page.getByText("Chegô: a loja não pôde aceitar seu pedido. O valor já foi devolvido.")).toBeVisible();
  await expect(page.getByText("WhatsApp", { exact: true })).toBeVisible();
});

test("as imagens geradas são servidas, e nada fora da pasta de imagens", async ({ request }) => {
  const logo = await request.get("/files/stores/pizzaria-forno-de-barro-logo.webp");
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toBe("image/webp");

  expect((await request.get("/files/products/..%2F..%2Fpackage.json")).status()).toBe(404);
  expect((await request.get("/files/outros/arquivo.webp")).status()).toBe(404);
  expect((await request.get("/files/stores/nao-existe.webp")).status()).toBe(404);
});
