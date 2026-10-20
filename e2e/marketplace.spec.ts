import { expect, test } from "@playwright/test";
import { chooseNeighborhood, db, freshDatabase, loginAs, productUrl, setClock, visible } from "./helpers";

// Uma sexta às 20h: os lugares de jantar e o Depósito estão abertos.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

test("banner de cupons: só cupons reais e válidos, copia o código, passa e fecha", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await chooseNeighborhood(page, "Centro");
  const banner = visible(page, "coupon-banner");
  await expect(banner).toBeVisible();

  // Os cupons do banco que valem agora: nada de expirado (VELHO) ou esgotado (ESGOTOU).
  const codes: string[] = [];
  const total = Number((await visible(page, "coupon-banner").getByTestId("coupon-position").textContent())!.split("/")[1]);
  for (let index = 0; index < total; index++) {
    codes.push((await visible(page, "coupon-code").textContent())!);
    await banner.getByRole("button", { name: "Próximo cupom" }).click();
  }
  expect(codes.sort()).toEqual(["FRETEGRATIS", "PIZZA10", "PRIMEIRA"]);

  // Visitante ainda não comprou: o da primeira compra vem primeiro, com as condições.
  await expect(visible(page, "coupon-code")).toHaveText("PRIMEIRA");
  await expect(banner).toContainText("R$ 10,00 de desconto");
  await expect(banner).toContainText("Na primeira compra · Pedido mínimo de R$ 30,00");
  await banner.getByRole("button", { name: "Copiar cupom" }).click();
  await expect(banner.getByRole("button", { name: "Copiado!" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("PRIMEIRA");

  // Fechar esconde a faixa e continua escondida ao voltar.
  await banner.getByRole("button", { name: "Fechar cupons" }).click();
  await expect(visible(page, "coupon-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "O que você procura hoje?" })).toBeVisible();
  await expect(visible(page, "coupon-banner")).toHaveCount(0);
});

test("quem já comprou não vê o cupom de primeira compra", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await chooseNeighborhood(page, "Centro");
  await expect(visible(page, "coupon-banner")).toBeVisible();
  await expect(visible(page, "coupon-banner")).not.toContainText("PRIMEIRA");
});

test("categoria: chips de subcategoria vindos dos dados, filtro de verdade e ordenação separada", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");

  // Mercado: os departamentos que têm produto; "Carnes" mostra só carnes.
  await page.goto("/categoria/mercado");
  const chips = visible(page, "subcategory-chips");
  await expect(chips.getByRole("link", { name: "Todos" })).toHaveAttribute("aria-current", "true");
  await expect(chips.getByRole("link", { name: "Pet shop" })).toHaveCount(0);
  await chips.getByRole("link", { name: "Carnes" }).click();
  await expect(page).toHaveURL(/sub=carnes/);
  await expect(chips.getByRole("link", { name: "Carnes" })).toHaveAttribute("aria-current", "true");
  const products = visible(page, "category-products");
  await expect(products).toContainText("Carne moída bandeja 500 g");
  await expect(products).not.toContainText("Arroz branco");
  await chips.getByRole("link", { name: "Todos" }).click();
  await expect(page).not.toHaveURL(/sub=/);
  await expect(visible(page, "category-products")).toHaveCount(0);

  // Restaurantes: "Pizzarias" deixa só a pizzaria.
  await page.goto("/categoria/restaurantes?sub=pizzarias");
  await expect(page.locator("main p:visible", { hasText: /^Pizzaria Forno de Barro$/ })).toBeVisible();
  await expect(page.locator("main p:visible", { hasText: /^Sushi Maré$/ })).toHaveCount(0);

  // Ordenar mantém os filtros e mostra a escolha.
  await page.goto("/categoria/restaurantes?aberto=1");
  await page.getByTestId("sort-menu").click();
  await page.getByRole("link", { name: "Menor taxa de entrega" }).click();
  await expect(page).toHaveURL(/aberto=1/);
  await expect(page).toHaveURL(/ordem=taxa/);
  await expect(page.getByTestId("sort-menu")).toContainText(/Ordem|Menor taxa/);
  await expect(page.getByRole("link", { name: "Limpar filtros" })).toBeVisible();

  // Shopping já está na navegação; sem lojas, convida a vender em vez de deixar a tela vazia.
  await page.goto("/");
  await page.getByRole("navigation", { name: "Categorias" }).getByRole("link", { name: "Shopping" }).click();
  await expect(visible(page, "category-empty")).toContainText("Ainda não tem lojas de Shopping");
  await expect(page.getByRole("link", { name: "Quero vender no Chegô" })).toBeVisible();
});

test("a loja põe produto em oferta e na subcategoria; o preço cobrado não muda", async ({ page }) => {
  await loginAs(page, "Larissa Pontes");
  const [granola] = await db`select id from products where name = 'Granola 250 g'`;
  await page.goto(`/lojista/cardapio/produto/${granola.id}`);

  await page.getByLabel("Preço de antes (oferta)").fill("10,00");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("O preço de antes precisa ser maior que o preço atual.")).toBeVisible();

  await page.getByLabel("Preço de antes (oferta)").fill("15,90");
  await page.getByLabel("Subcategoria").selectOption({ label: "Naturais e a granel" });
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("O preço de antes precisa ser maior que o preço atual.")).toHaveCount(0);
  await expect.poll(async () => (await db`
    select p.price_cents, p.compare_at_price_cents, sc.slug from products p left join subcategories sc on sc.id = p.subcategory_id
    where p.name = 'Granola 250 g'`)[0]).toEqual({ price_cents: 1290, compare_at_price_cents: 1590, slug: "naturais" });

  await page.goto(await productUrl("emporio-vida-verde", "Granola 250 g"));
  await expect(page.locator("article header p:visible").filter({ hasText: "R$ 12,90" })).toContainText("-18%");
  await expect(page.getByRole("button", { name: /^Adicionar • R\$ 12,90$/ })).toBeVisible();
});

test("o admin marca as subcategorias da loja e cria subcategoria nova", async ({ page }) => {
  await loginAs(page, "Admin Chegô");
  const [store] = await db`select id from stores where slug = 'pizzaria-forno-de-barro'`;
  await page.goto(`/admin/lojas/${store.id}`);
  await page.getByLabel("Comida brasileira").check();
  await page.getByRole("button", { name: "Salvar subcategorias" }).click();
  await expect(page.getByText("Subcategorias salvas.")).toBeVisible();

  await chooseNeighborhood(page, "Centro");
  await page.goto("/categoria/restaurantes?sub=brasileira");
  await expect(page.locator("main p:visible", { hasText: /^Pizzaria Forno de Barro$/ })).toBeVisible();

  await page.goto("/admin/cadastros");
  const restaurants = page.locator('[data-testid="admin-category"]', { has: page.locator('input[value="Restaurantes"]') });
  await restaurants.getByText(/^Subcategorias/).click();
  await restaurants.getByLabel("Nova subcategoria").fill("Comida árabe");
  await restaurants.getByRole("button", { name: "Criar" }).click();
  await expect(restaurants.getByText("Subcategoria criada.")).toBeVisible();
  expect((await db`select slug from subcategories where name = 'Comida árabe'`)[0].slug).toBe("comida-arabe");
});

// As setas das faixas aparecem do tablet para cima: estes rodam num navegador de computador.
test.describe("no computador", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("o início é das lojas; ofertas e mais pedidos ficam dentro de cada categoria, com setas que respeitam os limites", async ({ page }) => {
    await chooseNeighborhood(page, "Centro");
    // No início, nenhuma vitrine de produto: o foco são as lojas.
    await expect(page.locator('[data-testid="shelf-product"]:visible')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Abertas agora" })).toBeVisible();
    // A faixa de cupons é uma linha só.
    expect((await visible(page, "coupon-banner").boundingBox())!.height).toBeLessThanOrEqual(48);

    // Ofertas da farmácia ficam na Farmácia, e não no Mercado.
    await page.goto("/categoria/farmacia");
    await expect(visible(page, "category-offers")).toContainText("Protetor solar FPS 50 120 ml");
    await expect(visible(page, "category-offers")).not.toContainText("Arroz branco");

    await page.goto("/categoria/mercado");
    const offers = visible(page, "category-offers");
    const rice = offers.getByTestId("shelf-product").filter({ hasText: "Arroz branco 1 kg" });
    await expect(rice).toContainText("-18%");
    await expect(rice).toContainText("R$ 6,90");
    await expect(rice.locator("s")).toHaveText("R$ 8,49");
    await expect(offers).not.toContainText("Protetor solar");

    // "Mais pedidos" sai dos pedidos concluídos de verdade.
    const shelf = visible(page, "category-popular");
    await expect(shelf.getByTestId("shelf-product").first()).toBeVisible();
    const back = shelf.getByRole("button", { name: "Voltar: Mais pedidos em Mercado" });
    const next = shelf.getByRole("button", { name: "Avançar: Mais pedidos em Mercado" });
    await expect(back).toBeDisabled();
    await next.click();
    await expect(back).toBeEnabled();
    const list = shelf.getByRole("list", { name: "Mais pedidos em Mercado" });
    await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    // Vai até o fim: a seta da direita some.
    const settled = async () => {
      // Espera a rolagem suave terminar antes de olhar a seta de novo.
      let last = -1;
      await expect.poll(async () => {
        const now = await list.evaluate((element) => element.scrollLeft);
        const still = now === last;
        last = now;
        return still;
      }, { intervals: [150] }).toBe(true);
    };
    for (let i = 0; i < 8; i++) {
      await settled();
      if (!(await next.isEnabled())) break;
      await next.click();
    }
    await expect(next).toBeDisabled();
    await expect.poll(() => list.evaluate((element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)).toBe(true);
    await back.click();
    await expect(next).toBeEnabled();

    // O card leva à página do produto, que mostra o "de/por".
    await rice.click();
    await page.waitForURL(/\/produto\//);
    const price = page.locator("article header p:visible").filter({ hasText: "R$ 6,90" });
    await expect(price).toContainText("-18%");
    await expect(price.locator("s")).toHaveText("R$ 8,49");

    // A página nunca ganha rolagem lateral.
    await page.goto("/categoria/mercado");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("loja: vitrines do topo e produtos em duas colunas no computador", async ({ page }) => {
    await chooseNeighborhood(page, "Centro");
    await page.goto("/loja/brasa-burger");
    await expect(page.getByTestId("store-segment")).toContainText("Lanches · Hamburguerias");
    await expect(visible(page, "store-featured")).toContainText("Brasa Nordestino");
    await expect(visible(page, "store-popular").getByTestId("shelf-product").first()).toBeVisible();
    await expect(visible(page, "store-offers")).toContainText("Batata com cheddar e bacon");
    // Ninguém cadastrou produto novo depois da abertura: sem vitrine de novidades.
    await expect(visible(page, "store-newest")).toHaveCount(0);

    const rows = page.locator('[data-testid="menu-product"]:visible');
    const [first, second] = [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox()];
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    expect(second!.x).toBeGreaterThan(first!.x + first!.width - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
