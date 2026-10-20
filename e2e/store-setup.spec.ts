import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { addSimple, db, freshDatabase, loginAs, setClock, visible } from "./helpers";

// Uma sexta às 15h: o Empório Vida Verde está aberto.
test.beforeAll(() => freshDatabase("2026-10-09T15:00"));
test.afterAll(() => setClock(null));

const EMPORIO_OWNER = "Larissa Pontes";
const PNG = readFileSync("public/icons/icon-192.png");

test("bairros: a loja ativa Casal com taxa; o checkout só oferece os bairros atendidos e avisa os outros", async ({ page }) => {
  // Os bairros reais de Joaquim Gomes estão no cadastro da cidade.
  const names = (await db`select n.name from neighborhoods n join cities c on c.id = n.city_id where c.slug = 'joaquim-gomes'`).map((row) => row.name);
  expect(names).toEqual(expect.arrayContaining(["Centro", "Casal", "Matadouro", "Terrenos", "Asplanas", "Cacimbas"]));

  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/loja");
  const casal = page.locator("fieldset", { hasText: "Casal" });
  await expect(casal.getByRole("checkbox")).not.toBeChecked();
  await casal.getByRole("checkbox").check();
  await casal.getByLabel("Taxa de entrega em Casal").fill("4,00");
  await casal.getByLabel("Tempo mínimo em Casal").fill("20");
  await casal.getByLabel("Tempo máximo em Casal").fill("35");
  await page.getByRole("button", { name: "Salvar áreas de entrega" }).click();
  await expect(page.getByText("Áreas de entrega salvas.")).toBeVisible();
  const [area] = await db`
    select a.delivery_fee_cents from store_delivery_areas a join stores s on s.id = a.store_id join neighborhoods n on n.id = a.neighborhood_id
    where s.slug = 'emporio-vida-verde' and n.name = 'Casal'`;
  expect(area.delivery_fee_cents).toBe(400);
  // As taxas que já existiam não mudaram.
  const [centro] = await db`
    select a.delivery_fee_cents from store_delivery_areas a join stores s on s.id = a.store_id join neighborhoods n on n.id = a.neighborhood_id
    where s.slug = 'emporio-vida-verde' and n.name = 'Centro'`;
  expect(centro.delivery_fee_cents).toBe(300);

  // O cliente monta a sacola no Empório e cadastra um endereço novo.
  await db`delete from carts`;
  await loginAs(page, "Ana Clara Souza");
  await page.evaluate(() => window.localStorage.clear());
  await addSimple(page, "emporio-vida-verde", "Mel 300 g");
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Novo endereço" }).click();
  const select = page.getByLabel("Bairro ou comunidade");
  await expect(select.locator("option", { hasText: "Casal · entrega R$ 4,00" })).toHaveCount(1);
  await expect(select.locator("option", { hasText: "Matadouro" })).toHaveCount(0);
  await expect(page.getByText("Só aparecem os bairros onde esta loja entrega.")).toBeVisible();

  await page.getByLabel("Rua", { exact: true }).fill("Rua do Casal");
  await page.getByLabel("Número", { exact: true }).fill("12");
  await select.selectOption({ label: "Casal · entrega R$ 4,00" });
  await page.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(page.getByText("Rua do Casal, 12")).toBeVisible();
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]+$/);
  const orderId = page.url().match(/pedidos\/([0-9a-f-]+)$/)![1];
  // O bairro fica registrado no pedido.
  const [order] = await db`select n.name, o.delivery_fee_cents, o.address_snapshot->>'neighborhood' as snapshot from orders o join neighborhoods n on n.id = o.neighborhood_id where o.id = ${orderId}`;
  expect(order).toEqual({ name: "Casal", delivery_fee_cents: 400, snapshot: "Casal" });

  // Um endereço salvo num bairro que a loja não atende é avisado na hora.
  const [matadouro] = await db`select n.id from neighborhoods n join cities c on c.id = n.city_id where c.slug = 'joaquim-gomes' and n.name = 'Matadouro'`;
  const [ana] = await db`select id from profiles where full_name = 'Ana Clara Souza'`;
  await db`insert into addresses (profile_id, street, number, neighborhood_id, is_default) values (${ana.id}, 'Rua do Matadouro', '5', ${matadouro.id}, false)`;
  await addSimple(page, "emporio-vida-verde", "Mel 300 g");
  await page.goto("/checkout");
  await expect(visible(page, "address-not-served")).toContainText("Esta loja não entrega em Matadouro.");
});

test("logo e capa: botão visível, prévia, troca persistente e remoção", async ({ page }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/loja");
  const logo = visible(page, "image-input-logo");
  await expect(logo.getByText("Trocar imagem")).toBeVisible();
  await expect(logo.getByRole("img", { name: "Logo atual" })).toBeVisible();

  // Formato não aceito é recusado antes de enviar, com mensagem clara.
  await logo.locator('input[type="file"]').setInputFiles({ name: "logo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(logo.getByRole("alert")).toHaveText("Formato não aceito. Envie JPG, PNG, WebP.");

  const [before] = await db`select logo_url from stores where slug = 'emporio-vida-verde'`;
  await logo.locator('input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(logo.getByRole("img", { name: "Prévia: Logo" })).toBeVisible();
  await expect(logo.getByRole("status")).toContainText("Salve para confirmar");
  await page.getByRole("button", { name: "Salvar dados" }).click();
  await expect(page.getByText("Dados da loja salvos.")).toBeVisible();

  const [after] = await db`select logo_url from stores where slug = 'emporio-vida-verde'`;
  expect(after.logo_url).toMatch(/^\/files\/stores\/.+\.webp$/);
  expect(after.logo_url).not.toBe(before.logo_url);
  expect((await page.request.get(after.logo_url)).status()).toBe(200);
  // Depois de recarregar, a nova logo continua lá.
  await page.reload();
  await expect(visible(page, "image-input-logo").getByRole("img", { name: "Logo atual" })).toHaveAttribute("src", after.logo_url);

  // Remover a capa.
  const cover = visible(page, "image-input-cover");
  await cover.getByLabel("Remover").check();
  await expect(cover.getByText("Será removida ao salvar")).toBeVisible();
  await page.getByRole("button", { name: "Salvar dados" }).click();
  await expect(page.getByText("Dados da loja salvos.")).toBeVisible();
  expect((await db`select cover_url from stores where slug = 'emporio-vida-verde'`)[0].cover_url).toBeNull();
});

test("relatórios: cada número abre a lista dos pedidos que formam ele, com os mesmos filtros", async ({ page }) => {
  await loginAs(page, "Marcos Antônio Tavares");
  await page.goto("/lojista/relatorios?de=2026-09-01&ate=2026-10-09");
  const stats = page.locator('[data-testid="report-stats"]:visible');
  const card = (label: string) => stats.locator('[data-testid="stat"]', { hasText: label }).first();

  const salesText = (await card("Vendas").locator("p").nth(1).textContent())!.trim();
  await card("Vendas").click();
  await page.waitForURL(/segmento=vendidos/);
  await expect(page).toHaveURL(/de=2026-09-01/);
  await expect(visible(page, "segment-total")).toContainText(salesText);

  // O total da lista é a soma das linhas (conferido no banco).
  const [db1] = await db`
    select count(*)::int as n from orders o join stores s on s.id = o.store_id
    where s.slug = 'pizzaria-forno-de-barro' and o.paid_at is not null and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')
      and o.paid_at >= '2026-09-01T00:00:00-03:00' and o.paid_at < '2026-10-10T00:00:00-03:00'`;
  await expect(visible(page, "segment-total")).toContainText(`${db1.n} pedidos`);

  // Filtrar a lista por retirada e voltar ao relatório preserva o filtro.
  await page.getByLabel("Entrega, retirada ou mesa").selectOption("pickup");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await page.waitForURL(/modalidade=pickup/);
  await expect(visible(page, "active-filters")).toContainText("Retirada");
  const rows = page.locator('[data-testid="report-order"]:visible');
  for (const text of await rows.allTextContents()) expect(text).toContain("Retirada");
  await page.getByRole("link", { name: "← Voltar ao relatório" }).click();
  await page.waitForURL(/\/lojista\/relatorios\?.*modalidade=pickup/);
  await expect(visible(page, "active-filters")).toContainText("Retirada");

  // "A receber" (sem o filtro de retirada) mostra as colunas do recebimento.
  await page.goto("/lojista/relatorios?de=2026-09-01&ate=2026-10-09");
  await card("A receber").click();
  await page.waitForURL(/segmento=a_receber/);
  await expect(page.getByRole("columnheader", { name: "Recebimento" })).toBeVisible();
  await page.getByRole("link", { name: "Limpar filtros" }).first().click();
  await expect(page).not.toHaveURL(/modalidade/);
});

test("admin: simulador de receita calcula na hora e não grava nada", async ({ page }) => {
  const before = await db`select (select count(*)::int from fee_entries) as fees, (select value from platform_settings where key = 'order_fee_cents') as fee`;
  await loginAs(page, "Admin Chegô");
  await page.goto("/admin/simulador");
  await expect(visible(page, "real-performance")).toContainText("Desempenho real");
  const sim = visible(page, "simulator");
  await expect(sim).toContainText("Simulação · não é dinheiro real");
  // Cenário conservador: 10 lojas × 10 pedidos × 30 dias × R$ 0,50.
  await expect(sim.getByTestId("sim-revenue")).toHaveText("R$ 1.500,00");
  await expect(sim.getByTestId("sim-fee")).toHaveValue("0.5");

  await sim.getByLabel("Lojas", { exact: true }).fill("1000");
  await sim.getByLabel("Pedidos por loja por dia").fill("30");
  await expect(sim.getByTestId("sim-revenue")).toHaveText("R$ 450.000,00");
  await expect(sim.getByTestId("sim-daily")).toHaveText("R$ 15.000,00");
  await sim.getByTestId("sim-fee").fill("1");
  await expect(sim.getByTestId("sim-revenue")).toHaveText("R$ 900.000,00");
  await sim.getByRole("button", { name: "Restaurar valores do cenário" }).click();
  await expect(sim.getByTestId("sim-revenue")).toHaveText("R$ 1.500,00");

  // Nada foi gravado: nem taxa, nem a tarifa de produção.
  const after = await db`select (select count(*)::int from fee_entries) as fees, (select value from platform_settings where key = 'order_fee_cents') as fee`;
  expect(after).toEqual(before);
});
