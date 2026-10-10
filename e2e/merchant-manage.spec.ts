import { expect, test, type Page } from "@playwright/test";
import { chooseNeighborhood, db, loginAs, loginWithPhone, productUrl, setClock, visible, freshDatabase } from "./helpers";

// Uma sexta às 15h: o Empório, o Mercado e a Delícias da Vó estão abertos.
test.beforeAll(() => freshDatabase("2026-10-09T15:00"));
test.afterAll(() => setClock(null));

const EMPORIO_OWNER = "Larissa Pontes";
const row = (page: Page, name: string) => page.locator('[data-testid="menu-row"]:visible').filter({ hasText: name });

test("esgotar com um toque aparece na hora para o cliente", async ({ page, browser }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/cardapio");
  await row(page, "Granola 250 g").getByRole("button", { name: "Marcar Granola 250 g como esgotado" }).click();
  await expect(row(page, "Granola 250 g").getByRole("button")).toHaveText("Esgotado · reativar");

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(await productUrl("emporio-vida-verde", "Granola 250 g"));
  await expect(customer.locator('[data-testid="disabled-reason"]:visible')).toHaveText("Esgotado");
  await customer.context().close();

  await row(page, "Granola 250 g").getByRole("button").click();
  await expect(row(page, "Granola 250 g").getByRole("button")).toHaveText("Marcar esgotado");
});

test("criar produto com foto, ligar grupo de opções com preço próprio, duplicar e excluir", async ({ page, browser }) => {
  await loginAs(page, EMPORIO_OWNER);

  // Um grupo reutilizável, criado uma vez só.
  await page.goto("/lojista/cardapio/grupos");
  await page.getByLabel("Novo grupo").fill("Embalagem");
  await page.getByRole("button", { name: "Criar grupo" }).click();
  const group = page.locator('[data-testid="option-group"]:visible').filter({ hasText: "Embalagem" });
  await group.getByLabel("Nova opção").fill("Para presente");
  await group.getByLabel("Preço padrão").fill("2,00");
  await group.getByRole("button", { name: "Adicionar" }).click();
  await expect(group.locator('[data-testid="option-row"]')).toContainText("R$ 2,00");

  await page.goto("/lojista/cardapio/produto/novo");
  await page.getByLabel("Nome").fill("Cesta Natural de Teste");
  await page.getByLabel("Descrição").fill("Cesta com grãos e castanhas.");
  await page.getByLabel("Preço (R$)").fill("59,90");
  await page.getByLabel("Seção").selectOption({ label: "Grãos e castanhas" });
  await page.locator('input[name="image"]:visible').setInputFiles("storage-test/banners/primeira-compra.webp");
  await page.getByRole("button", { name: "Criar produto" }).click();
  await expect(page).toHaveURL(/\/lojista\/cardapio\/produto\/[0-9a-f-]{36}$/);

  // Um arquivo que não é imagem é recusado, seja qual for o nome.
  await page.locator('input[name="image"]:visible').setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("isto não é uma imagem") });
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Não deu para abrir esse arquivo como imagem.")).toBeVisible();

  await page.getByLabel("Ligar grupo de opções").selectOption({ label: "Embalagem" });
  await page.getByRole("button", { name: "Ligar grupo" }).click();
  const linked = page.locator('[data-testid="linked-group"]:visible');
  await linked.getByLabel("Preço de Para presente neste produto").fill("3,50");
  await linked.getByRole("button", { name: "Salvar preços" }).click();
  await expect(linked.getByText("Preços salvos.")).toBeVisible();

  const [product] = await db`select id, image_url, price_cents from products where name = 'Cesta Natural de Teste'`;
  expect(product.price_cents).toBe(5990);
  expect(product.image_url).toMatch(/^\/files\/products\/emporio-vida-verde\/[0-9a-f-]+-800\.webp$/);

  const customer = await (await browser.newContext()).newPage();
  expect((await customer.request.get(product.image_url)).status()).toBe(200);
  expect((await customer.request.get(product.image_url.replace("-800", "-400"))).status()).toBe(200);
  await customer.goto(`/loja/emporio-vida-verde/produto/${product.id}`);
  await expect(customer.getByText("+ R$ 3,50")).toBeVisible();
  await customer.getByRole("radio", { name: "Para presente" }).click();
  await expect(customer.getByRole("button", { name: /^Adicionar/ })).toHaveText("Adicionar • R$ 63,40");
  await customer.context().close();

  await page.getByRole("button", { name: "Duplicar produto" }).click();
  await expect(page.getByRole("heading", { name: "Cesta Natural de Teste (cópia)" })).toBeVisible();
  await page.getByRole("button", { name: "Excluir produto" }).click();
  await expect(page).toHaveURL(/\/lojista\/cardapio$/);
  await expect(row(page, "Cesta Natural de Teste (cópia)")).toHaveCount(0);
  await expect(row(page, "Cesta Natural de Teste")).toHaveCount(1);
});

test("planilha: exporta, importa criando e atualizando, e recusa arquivo com erro", async ({ page }) => {
  await loginAs(page, EMPORIO_OWNER);
  const exported = await page.request.get("/lojista/cardapio/exportar");
  expect(exported.headers()["content-type"]).toContain("text/csv");
  const csv = await exported.text();
  expect(csv).toContain("secao;nome;descricao;preco;disponivel;estoque");
  expect(csv).toContain("Mel 300 g;;22,00;sim;");

  await page.goto("/lojista/cardapio/planilha");
  const upload = (content: string) =>
    page.getByLabel("Arquivo CSV").setInputFiles({ name: "cardapio.csv", mimeType: "text/csv", buffer: Buffer.from(content, "utf8") });

  await upload("secao;nome;preco\nGrãos e castanhas;Mel 300 g;vinte\n");
  await page.getByRole("button", { name: "Importar planilha" }).click();
  await expect(page.getByText("Linha 2: preço inválido (“vinte”). Use o formato 12,50.")).toBeVisible();
  expect((await db`select price_cents from products where name = 'Mel 300 g'`)[0].price_cents).toBe(2200);

  await upload("secao;nome;descricao;preco;disponivel;estoque\nGrãos e castanhas;Mel 300 g;Mel puro;25,00;sim;12\nNovidades;Produto Novo da Planilha;;7,90;sim;\n");
  await page.getByRole("button", { name: "Importar planilha" }).click();
  await expect(page.getByText("Planilha importada: 1 produtos novos e 1 atualizados.")).toBeVisible();

  const honey = (await db`select price_cents, track_stock, stock_qty, description from products where name = 'Mel 300 g'`)[0];
  expect(honey).toEqual({ price_cents: 2500, track_stock: true, stock_qty: 12, description: "Mel puro" });
  const [created] = await db`
    select p.price_cents, s.name as section from products p join product_sections s on s.id = p.section_id
    where p.name = 'Produto Novo da Planilha'`;
  expect(created).toEqual({ price_cents: 790, section: "Novidades" });
});

test("reajuste de preços em lote só na seção escolhida", async ({ page }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/cardapio/planilha");
  await page.getByLabel("Onde aplicar").selectOption({ label: "Só na seção Chás" });
  await page.getByLabel("Percentual").fill("10");
  await page.getByRole("button", { name: "Aplicar reajuste" }).click();
  await expect(page.getByText("Preços reajustados em 2 produtos.")).toBeVisible();

  const prices = await db`select name, price_cents from products where name in ('Chá de camomila 30 g', 'Aveia em flocos 500 g') order by name`;
  expect(prices).toEqual([
    { name: "Aveia em flocos 500 g", price_cents: 850 },
    { name: "Chá de camomila 30 g", price_cents: 825 },
  ]);
});

test("dados da loja, área de entrega nova e fechamento especial valem para o cliente", async ({ page, browser }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/loja");
  await page.getByLabel("Pedido mínimo (R$)").fill("22,50");
  await page.getByLabel("Tempo de preparo (min)").fill("25");
  await page.getByRole("button", { name: "Salvar dados da loja" }).click();
  await expect(page.getByText("Dados da loja salvos.")).toBeVisible();

  await page.getByRole("checkbox", { name: /Sítio Mata Verde/ }).check();
  await page.getByLabel("Taxa de entrega em Sítio Mata Verde").fill("15,00");
  await page.getByLabel("Tempo mínimo em Sítio Mata Verde").fill("50");
  await page.getByLabel("Tempo máximo em Sítio Mata Verde").fill("80");
  await page.getByRole("button", { name: "Salvar áreas de entrega" }).click();
  await expect(page.getByText("Áreas de entrega salvas.")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Sítio Mata Verde");
  await customer.goto("/loja/emporio-vida-verde");
  await expect(customer.locator('[data-testid="delivery-text"]:visible')).toHaveText("Entrega R$ 15,00");
  await expect(customer.getByText("Pedido mínimo R$ 22,50")).toBeVisible();
  await expect(customer.locator('[data-testid="store-state"]:visible')).toHaveText("Aberta");

  // Fechar por hoje (um feriado) fecha a loja para os clientes.
  await page.getByLabel("De", { exact: true }).fill("2026-10-09");
  await page.getByLabel("Motivo").fill("Feriado de teste");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Feriado de teste")).toBeVisible();
  await customer.reload();
  await expect(customer.locator('[data-testid="store-state"]:visible')).toHaveText("Abre amanhã às 8h");
  await customer.context().close();

  await page.getByRole("button", { name: "Remover", exact: true }).click();
  const log = await db`select count(*)::int as total from audit_logs where action in ('store.update', 'store.areas')`;
  expect(log[0].total).toBeGreaterThanOrEqual(2);
});

test("horários: salvar dois turnos e um dia fechado", async ({ page }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/loja");
  await page.getByLabel("domingo: abre", { exact: true }).fill("09:00");
  await page.getByLabel("domingo: fecha", { exact: true }).fill("12:00");
  await page.getByLabel("sábado: segundo turno abre").fill("19:00");
  await page.getByLabel("sábado: segundo turno fecha").fill("22:00");
  await page.getByLabel("segunda: abre", { exact: true }).fill("");
  await page.getByLabel("segunda: fecha", { exact: true }).fill("");
  await page.getByRole("button", { name: "Salvar horários" }).click();
  await expect(page.getByText("Horários salvos.")).toBeVisible();

  const hours = await db`
    select h.weekday, h.opens_at::text, h.closes_at::text from store_hours h join stores s on s.id = h.store_id
    where s.slug = 'emporio-vida-verde' and h.weekday in (0, 1, 6) order by h.weekday, h.opens_at`;
  expect(hours).toEqual([
    { weekday: 0, opens_at: "09:00:00", closes_at: "12:00:00" },
    { weekday: 6, opens_at: "08:00:00", closes_at: "18:00:00" },
    { weekday: 6, opens_at: "19:00:00", closes_at: "22:00:00" },
  ]);
});

test("convidar entregador por telefone: ele entra e cai nas entregas da loja", async ({ page, browser }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/loja");
  await page.getByLabel("Nome", { exact: true }).fill("Tiago Motoboy");
  await page.getByLabel("Telefone com DDD").fill("(82) 96666-0001");
  await page.getByLabel("Papel").selectOption("courier");
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.locator('[data-testid="team-member"]:visible').filter({ hasText: "Tiago Motoboy" })).toContainText("Entregador");

  const courier = await (await browser.newContext()).newPage();
  await loginWithPhone(courier, "(82) 96666-0001");
  // Primeiro acesso: ele aceita os termos (os do lojista também).
  await courier.getByRole("checkbox").check();
  await courier.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(courier).toHaveURL(/\/lojista\/entregas$/);
  await expect(courier.getByRole("heading", { name: "Minhas entregas" })).toBeVisible();
  await courier.context().close();

  await page.getByRole("button", { name: "Remover Tiago Motoboy da equipe" }).click();
  await expect(page.locator('[data-testid="team-member"]:visible').filter({ hasText: "Tiago Motoboy" })).toHaveCount(0);
});

test("cupom da loja é pago pela loja e funciona no carrinho", async ({ page, browser }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/cupons");
  await page.getByLabel("Código").fill("emporio5");
  await page.getByLabel("Tipo").selectOption("fixed");
  await page.getByLabel("Valor do desconto (R$)").fill("5,00");
  await page.getByRole("button", { name: "Criar cupom" }).click();
  await expect(page.locator('[data-testid="store-coupon"]:visible')).toContainText("EMPORIO5");
  const [coupon] = await db`select paid_by, array_length(store_ids, 1) as stores from coupons where code = 'EMPORIO5'`;
  expect(coupon).toEqual({ paid_by: "store", stores: 1 });

  const context = await browser.newContext();
  const customer = await context.newPage();
  await db`delete from carts`;
  await loginAs(customer, "Bruno Henrique Lima");
  await customer.goto(await productUrl("emporio-vida-verde", "Mix de castanhas 200 g"));
  await customer.getByRole("button", { name: /^Adicionar/ }).click();
  await customer.waitForURL(/\/loja\/emporio-vida-verde$/);
  await customer.goto("/carrinho");
  await customer.getByLabel("Cupom de desconto").fill("EMPORIO5");
  await customer.getByRole("button", { name: "Aplicar" }).click();
  await expect(customer.locator('[data-testid="summary-discount"]:visible')).toHaveText("− R$ 5,00");
  await context.close();
});

test("responder avaliação aparece na página pública da loja", async ({ page }) => {
  await loginAs(page, "Marcos Antônio Tavares");
  await page.goto("/lojista/avaliacoes");
  const review = page.locator('[data-testid="merchant-review"]:visible').filter({ has: page.getByLabel("Responder (todo mundo vê)") }).first();
  await review.getByLabel("Responder (todo mundo vê)").fill("Obrigado! Resposta de teste da pizzaria.");
  await review.getByRole("button", { name: "Publicar resposta" }).click();
  await expect(page.getByText("Sua resposta: Obrigado! Resposta de teste da pizzaria.")).toBeVisible();
  expect((await db`select count(*)::int as total from reviews where reply = 'Obrigado! Resposta de teste da pizzaria.'`)[0].total).toBe(1);
});

test("relatórios e extrato são só do dono; atendente não entra", async ({ page }) => {
  await loginAs(page, "Marcos Antônio Tavares");
  await page.goto("/lojista/relatorios?dias=90");
  const stats = page.locator('[data-testid="stat"]:visible');
  await expect(stats.filter({ hasText: "Pedidos" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Produtos mais vendidos" })).toBeVisible();

  const exported = await page.request.get("/lojista/relatorios/exportar?dias=90");
  expect(exported.headers()["content-type"]).toContain("text/csv");
  expect(await exported.text()).toMatch(/^﻿pedido;pago_em;situacao;total_pago/);

  await page.goto("/lojista/financeiro");
  await expect(visible(page, "statement")).toBeVisible();
  await expect(page.getByText(/Sua taxa hoje: 12,0%/)).toBeVisible();

  // Os números batem com o banco.
  const [expected] = await db`
    select count(*)::int as orders from orders o join stores s on s.id = o.store_id
    where s.slug = 'pizzaria-forno-de-barro' and o.paid_at is not null
      and o.status not in ('rejected', 'cancelled', 'refunded', 'expired')
      and o.paid_at >= ${new Date(new Date("2026-10-09T15:00:00-03:00").getTime() - 90 * 86_400_000)}
      and o.paid_at < ${new Date("2026-10-09T15:00:00-03:00")}`;
  await page.goto("/lojista/relatorios?dias=90");
  await expect(stats.filter({ hasText: "Pedidos" }).first()).toContainText(String(expected.orders));

  await loginAs(page, "Juliana Peixoto");
  for (const path of ["/lojista/relatorios", "/lojista/financeiro", "/lojista/loja", "/lojista/cupons"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/lojista\/pedidos$/);
  }
  expect((await page.request.get("/lojista/relatorios/exportar", { maxRedirects: 0 })).status()).toBe(307);
});

test("fatura da mensalidade é paga pelo app", async ({ page }) => {
  await loginAs(page, "Rosângela Batista");
  await page.goto("/lojista/financeiro");
  const open = page.locator('[data-testid="invoice"]:visible').filter({ hasText: "Em aberto" });
  await expect(open).toHaveCount(1);
  await open.getByRole("button", { name: "Pagar pelo app" }).click();
  await expect(page.locator('[data-testid="invoice"]:visible').filter({ hasText: "Em aberto" })).toHaveCount(0);

  const [invoice] = await db`
    select i.status, i.paid_at is not null as paid,
           (select count(*)::int from ledger_entries l where l.invoice_id = i.id and l.reason = 'subscription') as ledger
    from invoices i join stores s on s.id = i.store_id
    where s.slug = 'mercado-boa-compra' order by i.period_start desc limit 1`;
  expect(invoice).toEqual({ status: "paid", paid: true, ledger: 1 });
});

test("QR Code e cartaz da loja para imprimir", async ({ page }) => {
  await loginAs(page, EMPORIO_OWNER);
  await page.goto("/lojista/divulgacao");
  await expect(visible(page, "store-qr")).toBeVisible();
  await expect(page.getByText(/\/loja\/emporio-vida-verde$/)).toBeVisible();

  const poster = await page.request.get("/lojista/divulgacao/cartaz");
  expect(poster.headers()["content-type"]).toBe("application/pdf");
  expect((await poster.body()).subarray(0, 5).toString()).toBe("%PDF-");

  const qr = await page.request.get("/lojista/divulgacao/qrcode");
  expect(qr.headers()["content-type"]).toBe("image/png");
});

test("regra da pizza meio a meio: a loja troca para a média dos sabores", async ({ page, browser }) => {
  await setClock("2026-10-09T20:00");
  try {
    await loginAs(page, "Marcos Antônio Tavares");
    await page.goto("/lojista/loja");
    await page.getByLabel("Pizza com mais de um sabor").selectOption("average");
    await page.getByRole("button", { name: "Salvar dados da loja" }).click();
    await expect(page.getByText("Dados da loja salvos.")).toBeVisible();

    const customer = await (await browser.newContext()).newPage();
    await customer.goto(await productUrl("pizzaria-forno-de-barro", "Pizza Grande (8 fatias)"));
    await expect(customer.getByText("Com mais de um sabor, cobramos a média dos sabores.")).toBeVisible();
    await customer.getByRole("checkbox", { name: "Calabresa", exact: true }).click();
    await customer.getByRole("checkbox", { name: "Carne de Sol com Queijo Coalho" }).click();
    await expect(customer.getByRole("button", { name: /^Adicionar/ })).toHaveText("Adicionar • R$ 50,50");
    await customer.context().close();
  } finally {
    await page.getByLabel("Pizza com mais de um sabor").selectOption("highest");
    await page.getByRole("button", { name: "Salvar dados da loja" }).click();
    await expect(page.getByText("Dados da loja salvos.")).toBeVisible();
    await setClock("2026-10-09T15:00");
  }
});
