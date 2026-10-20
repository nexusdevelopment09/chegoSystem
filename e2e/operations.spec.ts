import { expect, test } from "@playwright/test";
import { db, freshDatabase, loginAs, setClock } from "./helpers";

// Equipe por convite, estoque, mesas e relatório anual, pelo navegador.
test.beforeAll(() => freshDatabase("2026-10-09T19:00"));
test.afterAll(() => setClock(null));

const PIZZA_OWNER = "Marcos Antônio Tavares";

test("convite de uso único: o funcionário cria o acesso, entra com as permissões padrão e o link não serve de novo", async ({ page, browser }) => {
  await loginAs(page, PIZZA_OWNER);
  await page.goto("/lojista/equipe");
  const form = page.getByTestId("invite-form");
  await form.getByLabel("Nome completo").fill("Bruno Convidado");
  await form.getByLabel("Telefone (opcional)").fill("(82) 95555-0101");
  await form.getByRole("button", { name: "Criar convite" }).click();
  const link = (await page.getByTestId("invite-link").locator("code").textContent())!.trim();
  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]+$/);
  // Só o hash do convite fica no banco.
  const token = link.split("/").pop()!;
  expect((await db`select count(*)::int as n from store_invites where token_hash = ${token}`)[0].n).toBe(0);

  const guest = await browser.newContext();
  const invited = await guest.newPage();
  await invited.goto(link);
  const accept = invited.getByTestId("accept-invite");
  await accept.getByLabel("Telefone com DDD").fill("(82) 95555-0101");
  await accept.getByLabel("Crie uma senha").fill("senha-do-bruno");
  await accept.getByRole("button", { name: "Aceitar convite" }).click();
  await invited.waitForURL(/\/lojista\/pedidos$/);

  // Atendente: sem financeiro.
  await invited.goto("/lojista/financeiro");
  await expect(invited).toHaveURL(/\/lojista\?negado=1$/);

  // O mesmo link não vale de novo.
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(link);
  await expect(second.getByTestId("accept-invite")).toHaveCount(0);
  await Promise.all([guest.close(), other.close()]);
});

test("estoque: item novo abaixo do mínimo gera alerta de estoque baixo", async ({ page }) => {
  await loginAs(page, PIZZA_OWNER);
  await page.goto("/lojista/estoque");
  // Sem itens o bloco já vem aberto; com itens, abre no clique.
  const details = page.locator("details").filter({ has: page.getByText("Novo item", { exact: true }) });
  if ((await details.getAttribute("open")) === null) await page.getByText("Novo item", { exact: true }).click();
  await page.getByLabel("Nome do produto ou insumo").fill("Farinha do teste");
  await page.getByLabel("Saldo inicial").fill("3");
  await page.getByLabel("Estoque mínimo").fill("10");
  await page.getByRole("button", { name: "Cadastrar item" }).click();
  // O item novo abre na própria página.
  await expect(page.getByRole("heading", { name: "Farinha do teste", level: 1 })).toBeVisible();

  const [alert] = await db`
    select a.kind::text from stock_alerts a join stock_items i on i.id = a.item_id where i.name = 'Farinha do teste' and a.resolved_at is null`;
  expect(alert.kind).toBe("baixo");
  await page.goto("/lojista/painel");
  await expect(page.getByTestId("dash-low")).toContainText("Farinha do teste");
});

test("mesa: abre conta, lança item, recebe e fecha; vira pedido do canal mesa com a taxa de R$ 0,50", async ({ page }) => {
  await loginAs(page, PIZZA_OWNER);
  const [product] = await db`
    select p.id, p.price_cents from products p join stores s on s.id = p.store_id
    where s.slug = 'pizzaria-forno-de-barro' and p.deleted_at is null and p.available
      and not exists (select 1 from product_option_groups g where g.product_id = p.id and (g.required or g.min_choices > 0))
      and not exists (select 1 from product_availability a where a.product_id = p.id)
      and (not p.track_stock or p.stock_qty > 2)
    order by p.price_cents desc limit 1`;

  await page.goto("/lojista/mesas");
  await page.getByLabel("Número ou nome da mesa").fill("Teste 9");
  await page.getByRole("button", { name: "Cadastrar mesa" }).click();
  const table = page.getByTestId("table").filter({ hasText: "Teste 9" });
  await table.getByRole("button", { name: "Abrir conta" }).click();
  await page.waitForURL(/\/lojista\/mesas\/conta\/[0-9a-f-]+$/);

  const form = page.getByTestId("bill-item-form");
  await form.getByLabel("Produto").selectOption(product.id);
  await form.getByRole("button", { name: /^Adicionar ·/ }).click();
  await expect(page.getByTestId("bill-items")).toContainText("1");
  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByTestId("bill-remaining")).toHaveCount(0);
  await page.getByRole("button", { name: /^Fechar conta/ }).click();
  await expect(page.getByText(/fechada por/)).toBeVisible();

  const [order] = await db`
    select o.id, o.channel::text, o.status::text, o.total_cents from orders o join table_bills b on b.order_id = o.id
    join store_tables t on t.id = b.table_id where t.label = 'Teste 9'`;
  expect(order).toMatchObject({ channel: "mesa", status: "picked_up", total_cents: product.price_cents });
  expect((await db`select amount_cents from fee_entries where order_id = ${order.id} and kind = 'order_fee'`).map((row) => row.amount_cents)).toEqual([50]);
});

test("relatório anual e balancete abrem com os números do período", async ({ page }) => {
  await loginAs(page, PIZZA_OWNER);
  await page.goto("/lojista/relatorios/anual");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("2026").first()).toBeVisible();
  await page.goto("/lojista/relatorios/balancete");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
