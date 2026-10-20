import { expect, test } from "@playwright/test";
import { db, freshDatabase, loginAs, setClock } from "./helpers";

// Resumo do dia, auditoria e acesso por permissão, pelo navegador.
test.beforeAll(() => freshDatabase("2026-10-09T19:00"));
test.afterAll(() => setClock(null));

const PIZZA_OWNER = "Marcos Antônio Tavares";
const PIZZA_ATTENDANT = "Juliana Peixoto";

test("resumo do dia: vendas, pedidos em andamento e atalhos para o dono", async ({ page }) => {
  await loginAs(page, PIZZA_OWNER);
  await page.goto("/lojista/painel");
  await expect(page.getByRole("heading", { name: "Resumo do dia" })).toBeVisible();
  await expect(page.getByTestId("dash-sales")).toContainText("Vendido hoje");
  await expect(page.getByTestId("dash-progress")).toContainText("Pedidos em andamento");
  await expect(page.getByTestId("dash-low")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Atalhos" }).getByRole("link", { name: "Fechamento de caixa" })).toBeVisible();
});

test("atendente: resumo sem vendas, área sem permissão negada e registrada na auditoria", async ({ page, browser }) => {
  await loginAs(page, PIZZA_ATTENDANT);
  await page.goto("/lojista/painel");
  await expect(page.getByTestId("dash-progress")).toBeVisible();
  // Atendente não vê faturamento nem o atalho do caixa.
  await expect(page.getByTestId("dash-sales")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fechamento de caixa" })).toHaveCount(0);

  await page.goto("/lojista/auditoria");
  await expect(page).toHaveURL(/\/lojista\?negado=1$/);
  await expect(page.getByTestId("access-denied")).toContainText("não tem acesso");

  // O dono encontra a tentativa negada e a entrada da atendente na auditoria.
  const owner = await browser.newPage();
  await loginAs(owner, PIZZA_OWNER);
  await owner.goto("/lojista/auditoria?resultado=negado");
  const denied = owner.getByTestId("audit-row").filter({ hasText: "Tentou abrir área sem permissão" });
  await expect(denied.first()).toContainText(PIZZA_ATTENDANT);
  await denied.first().locator("summary").click();
  await expect(denied.first()).toContainText("auditoria.ver");

  await owner.goto("/lojista/auditoria?modulo=acesso");
  await expect(owner.getByTestId("audit-row").filter({ hasText: "Entrou no sistema" }).first()).toBeVisible();
  // Nada de outra loja aparece aqui.
  const [other] = await db`select owner_id from stores where slug = 'brasa-burger'`;
  const [{ name }] = await db`select full_name as name from profiles where id = ${other.owner_id}`;
  await expect(owner.getByTestId("store-audit")).not.toContainText(name);
  await owner.close();
});

test("mudança de preço do produto fica na auditoria com antes e depois", async ({ page }) => {
  await loginAs(page, PIZZA_OWNER);
  const [product] = await db`
    select p.id, p.price_cents from products p join stores s on s.id = p.store_id
    where s.slug = 'pizzaria-forno-de-barro' and p.deleted_at is null and p.weight_step_grams is null and p.compare_at_price_cents is null
    order by p.name limit 1`;
  await page.goto(`/lojista/cardapio/produto/${product.id}`);
  const price = page.locator('input[name="price"]');
  await price.fill(((product.price_cents + 100) / 100).toFixed(2).replace(".", ","));
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto salvo.")).toBeVisible();

  const [log] = await db`select action, details from audit_logs where entity_id = ${product.id} order by created_at desc limit 1`;
  expect(log.action).toBe("produtos.preco_alterado");
  expect(log.details.antes.price_cents).toBe(product.price_cents);
  expect(log.details.depois.price_cents).toBe(product.price_cents + 100);
});
