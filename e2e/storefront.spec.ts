import { expect, test } from "@playwright/test";
import { chooseNeighborhood, loginAs, setClock, freshDatabase } from "./helpers";

// Uma sexta às 20h: os lugares de jantar estão abertos e a loja de quentinhas, fechada.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

test("primeira visita escolhe o bairro e vê só as lojas da cidade", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/boas-vindas$/);

  await chooseNeighborhood(page, "Centro");
  await expect(page.getByTestId("current-location")).toHaveText("Centro, Joaquim Gomes");

  await expect(page.getByRole("heading", { name: "Abertas agora" })).toBeVisible();
  await expect(page.getByText("Pizzaria Forno de Barro").first()).toBeVisible();
  // Lojas pendentes, suspensas e de outra cidade nunca aparecem.
  for (const hidden of ["Espetinho do Zé", "Pastelaria Sabor Antigo", "Lanchonete Ponto Certo"]) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }
});

test("os banners passam sozinhos, têm setas e pausa, e param com 'reduzir movimento'", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");
  const carousel = page.getByRole("region", { name: "Promoções" });
  const dots = carousel.getByRole("button", { name: /^Ir para o banner/ });
  // Tira o mouse de cima: com o mouse sobre a faixa ela fica parada de propósito.
  const awayFromCarousel = () => page.mouse.move(1, 1);

  await expect(dots.first()).toHaveAttribute("aria-current", "true");
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true", { timeout: 9_000 });

  await carousel.getByRole("button", { name: "Banner anterior" }).click();
  await expect(dots.first()).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: "Próximo banner" }).click();
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");

  // Pausado, não anda; ao continuar, volta a andar.
  await carousel.getByRole("button", { name: "Pausar os banners" }).click();
  await awayFromCarousel();
  await page.waitForTimeout(6_000);
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: "Continuar a passar os banners" }).click();
  await awayFromCarousel();
  await expect(dots.nth(1)).not.toHaveAttribute("aria-current", "true", { timeout: 9_000 });

  // Os banners continuam clicáveis enquanto a faixa anda.
  await expect(carousel.getByRole("img").first()).toBeVisible();

  // Com "reduzir movimento" no aparelho nada anda sozinho, e não há botão de pausa.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(dots.first()).toHaveAttribute("aria-current", "true");
  await expect(carousel.getByRole("button", { name: "Pausar os banners" })).toHaveCount(0);
  await page.waitForTimeout(6_000);
  await expect(dots.first()).toHaveAttribute("aria-current", "true");
});

test("cada categoria leva à sua página", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");
  const categories = page.getByRole("navigation", { name: "Categorias" });
  await expect(categories.getByRole("link")).toHaveCount(8);
  await categories.getByRole("link", { name: "Lanches" }).click();
  await expect(page).toHaveURL(/\/categoria\/lanches$/);
  await expect(page.getByRole("heading", { name: "Lanches" })).toBeVisible();
});

test("abertas primeiro, destaques em seção própria e fechadas dizem quando abrem", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");

  const featured = page.locator("section", { has: page.getByRole("heading", { name: "Destaques" }) });
  await expect(featured.getByText("Lojas com destaque pago")).toBeVisible();
  await expect(featured.getByTestId("store-card")).toHaveCount(1);
  await expect(featured.getByTestId("store-card")).toContainText("Pizzaria Forno de Barro");

  const closed = page.locator("section", { has: page.getByRole("heading", { name: "Fechadas no momento" }) });
  await expect(closed.getByTestId("store-card").filter({ hasText: "Quentinha da Dona Lia" })).toContainText("Abre amanhã às 9h");

  const open = page.locator("section", { has: page.getByRole("heading", { name: "Abertas agora" }) });
  await expect(open.getByTestId("store-card").filter({ hasText: "Quentinha da Dona Lia" })).toHaveCount(0);
  await expect(open.getByTestId("store-card").filter({ hasText: "Brasa Burger" })).toContainText("Entrega R$ 3,00");
});

test("zona rural: taxa certa em quem atende e aviso em quem não atende", async ({ page }) => {
  await chooseNeighborhood(page, "Sítio Mata Verde");

  await page.goto("/loja/deposito-gelada-ja");
  await expect(page.getByTestId("delivery-text")).toHaveText("Entrega R$ 12,00");

  await page.goto("/loja/brasa-burger");
  await expect(page.getByTestId("no-delivery")).toHaveText(
    "Essa loja ainda não entrega em Sítio Mata Verde. Você pode retirar no balcão.",
  );
});

test("busca acha loja e produto sem acento, e avisa quando não acha nada", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");

  await page.goto("/busca?q=acai");
  await expect(page.getByTestId("store-card").filter({ hasText: "Açaí Tropical" })).toHaveCount(1);
  await expect(page.getByTestId("product-hit").filter({ hasText: "Açaí 500 ml" })).toHaveCount(1);

  await page.goto("/busca?q=xyzabc");
  await expect(page.getByText("Oxe, não achamos nada com “xyzabc”.")).toBeVisible();

  // Digitar mostra sugestões.
  await page.goto("/busca");
  await page.getByRole("searchbox").fill("pizza");
  await expect(page.getByRole("button", { name: "Pizzaria Forno de Barro" })).toBeVisible();
});

test("filtros e categoria", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");

  await page.goto("/categoria/lanches");
  await expect(page.getByRole("heading", { name: "Lanches" })).toBeVisible();
  await expect(page.getByTestId("store-card")).toHaveCount(2);
  await expect(page.getByText("Espetinho do Zé")).toHaveCount(0);

  await page.getByRole("link", { name: "Abertas agora" }).click();
  await expect(page).toHaveURL(/aberto=1/);
  await expect(page.getByTestId("store-card")).toHaveCount(1);
  await expect(page.getByTestId("store-card")).toContainText("Brasa Burger");
});

test("página da loja: seções, esgotados no fim, avisos e informações", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");

  await page.goto("/loja/mercado-boa-compra");
  await expect(page.getByTestId("store-state")).toHaveText("Abre amanhã às 7h");
  await expect(page.getByRole("link", { name: "Hortifrúti" })).toBeVisible();
  const produce = page
    .locator("section", { has: page.getByRole("heading", { name: "Hortifrúti" }) })
    .getByTestId("menu-product");
  await expect(produce.last()).toContainText("Mamão unidade");
  await expect(produce.last()).toContainText("Esgotado");

  await page.goto("/loja/farmacia-saude-mais");
  await expect(page.getByText("Medicamentos com receita não são vendidos pelo app.")).toBeVisible();
  await expect(page.getByTestId("store-state")).toHaveText("Aberta");

  await page.goto("/loja/pizzaria-forno-de-barro");
  await expect(page.getByText("a partir de R$ 45,00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Avaliações" })).toBeVisible();
  await expect(page.getByText("Sítio Riacho Fundo (zona rural)")).toBeVisible();

  // Lojas não aprovadas, ou de uma cidade inativa, não têm página.
  for (const slug of ["espetinho-do-ze", "pastelaria-sabor-antigo", "lanchonete-ponto-certo"]) {
    await page.goto(`/loja/${slug}`);
    await expect(page.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();
  }
});

test("favoritar e desfavoritar uma loja", async ({ page }) => {
  await loginAs(page, "Diego Alves");
  await page.goto("/loja/acai-tropical");
  await page.getByRole("button", { name: "Adicionar aos favoritos" }).click();
  await expect(page.getByRole("button", { name: "Tirar dos favoritos" })).toBeVisible();

  await page.goto("/favoritos");
  await expect(page.getByTestId("store-card")).toHaveCount(1);
  await expect(page.getByTestId("store-card")).toContainText("Açaí Tropical");

  await page.goto("/loja/acai-tropical");
  await page.getByRole("button", { name: "Tirar dos favoritos" }).click();
  await expect(page.getByRole("button", { name: "Adicionar aos favoritos" })).toBeVisible();
  await page.goto("/favoritos");
  await expect(page.getByText("Você ainda não tem lojas favoritas.")).toBeVisible();
});

test("link da loja tem prévia para o WhatsApp", async ({ page, request }) => {
  await page.goto("/loja/pizzaria-forno-de-barro");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Pizzaria Forno de Barro no Chegô");
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toContain("/loja/pizzaria-forno-de-barro/opengraph-image");

  const url = new URL(image!);
  const response = await request.get(url.pathname + url.search);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});
