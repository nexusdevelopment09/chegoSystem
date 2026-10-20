import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chooseNeighborhood, db, loginAs, productUrl, setClock, freshDatabase } from "./helpers";

// Acessibilidade, telas pequenas e segurança básica, conferidas nas páginas de verdade.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

/** Verificação automática de acessibilidade (contraste, rótulos, nomes, papéis...). */
async function expectAccessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const problems = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length}x, ex.: ${violation.nodes[0].target.join(" ")})`);
  expect(problems, `Problemas de acessibilidade em ${name}`).toEqual([]);
}

/** Nada pode ser mais largo que a tela do celular, e o que se toca tem que ser grande o bastante. */
async function expectFitsPhone(page: Page, name: string) {
  const report = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const small = [...document.querySelectorAll<HTMLElement>("button, a[class*='min-h'], input[type=checkbox], input[type=radio], select, input:not([type=hidden]):not([type=file])")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        // Caixas de seleção e botões de rádio são caixinhas dentro de um rótulo, que é a área de toque de verdade.
        const target = element.matches("input[type=checkbox], input[type=radio]") ? element.closest("label") ?? element : element;
        return target.getBoundingClientRect().height < 43.5;
      })
      .map((element) => `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}"`);
    const wide = overflow <= 0 ? [] : [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)}`);
    return { overflow, wide, small: [...new Set(small)] };
  });
  expect(report.wide, `${name}: a página está mais larga que a tela`).toEqual([]);
  expect(report.overflow, `${name}: a página está mais larga que a tela`).toBeLessThanOrEqual(0);
  expect(report.small, `${name}: áreas de toque menores que 44px`).toEqual([]);
}

async function check(page: Page, path: string, ready: () => Promise<unknown>) {
  await page.goto(path);
  await ready();
  await expectFitsPhone(page, path);
  await expectAccessible(page, path);
}

test("telas do cliente: acessíveis e sem estourar a tela do celular", async ({ page }) => {
  await check(page, "/", () => page.getByRole("heading", { name: "Abertas agora" }).waitFor());
  await check(page, "/boas-vindas?onde=1", () => page.getByRole("button", { name: "Ver as lojas" }).waitFor());
  await check(page, "/entrar", () => page.getByRole("button", { name: "Entrar", exact: true }).waitFor());
  await check(page, "/entrar/criar-conta", () => page.getByRole("button", { name: "Criar minha conta" }).waitFor());
  await check(page, "/entrar/loja", () => page.getByRole("heading", { name: "Área do lojista" }).waitFor());
  await check(page, "/entrar/entregador", () => page.getByRole("heading", { name: "Área do entregador" }).waitFor());
  await check(page, "/quero-vender", () => page.getByRole("button", { name: "Enviar cadastro" }).waitFor());
  await check(page, "/quero-entregar", () => page.getByRole("button", { name: "Enviar cadastro" }).waitFor());
  await check(page, "/ajuda", () => page.getByRole("heading", { name: "Ajuda" }).waitFor());

  await chooseNeighborhood(page, "Centro");
  await check(page, "/", () => page.getByRole("heading", { name: "Abertas agora" }).waitFor());
  await check(page, "/busca?q=pizza", () => page.getByRole("heading", { name: /Lojas com/ }).waitFor());
  await check(page, "/categoria/restaurantes", () => page.getByRole("heading", { name: "Restaurantes", exact: true }).waitFor());
  await check(page, "/loja/pizzaria-forno-de-barro", () => page.getByRole("button", { name: "Ver mais" }).waitFor());
  await check(page, await productUrl("pizzaria-forno-de-barro", "Pizza Grande (8 fatias)"), () => page.getByRole("button", { name: /^Adicionar/ }).waitFor());

  await loginAs(page, "Ana Clara Souza");
  await page.goto(await productUrl("brasa-burger", "Batata com cheddar e bacon"));
  await page.getByRole("button", { name: /^Adicionar/ }).click();
  await page.waitForURL(/\/loja\/brasa-burger$/);
  await check(page, "/carrinho", () => page.locator('[data-testid="summary-total"]:visible').waitFor());
  await check(page, "/checkout", () => page.locator('[data-testid="summary-total"]:visible').waitFor());
  await check(page, "/pedidos", () => page.getByRole("heading", { name: "Meus pedidos" }).waitFor());
  await check(page, "/perfil", () => page.getByRole("button", { name: "Salvar meus dados" }).waitFor());
  await check(page, "/notificacoes", () => page.getByRole("heading", { name: "Notificações" }).waitFor());

  const [order] = await db`
    select o.id from orders o join profiles p on p.id = o.customer_id
    where p.full_name = 'Ana Clara Souza' and o.status = 'delivered' order by o.created_at desc limit 1`;
  await check(page, `/pedidos/${order.id}`, () => page.locator('[data-testid="order-timeline"]:visible').waitFor());
});

test("painéis do lojista e do admin: acessíveis e sem estourar a tela do celular", async ({ page }) => {
  await loginAs(page, "Marcos Antônio Tavares");
  await check(page, "/lojista/pedidos", () => page.getByText("Concluídos hoje").first().waitFor());
  await check(page, "/lojista/entregas", () => page.getByRole("heading", { name: "Entregas na rua" }).waitFor());
  await check(page, "/lojista/cardapio", () => page.getByRole("link", { name: "Novo produto" }).waitFor());
  await check(page, "/lojista/cardapio/grupos", () => page.getByRole("button", { name: "Criar grupo" }).waitFor());
  await check(page, "/lojista/cardapio/planilha", () => page.getByRole("button", { name: "Importar planilha" }).waitFor());
  await check(page, "/lojista/loja", () => page.getByRole("button", { name: "Salvar horários" }).waitFor());
  await check(page, "/lojista/cupons", () => page.getByRole("button", { name: "Criar cupom" }).waitFor());
  await check(page, "/lojista/avaliacoes", () => page.getByRole("heading", { name: "Avaliações" }).waitFor());
  await check(page, "/lojista/relatorios", () => page.getByRole("heading", { name: "Produtos mais vendidos" }).waitFor());
  await check(page, "/lojista/financeiro", () => page.locator('[data-testid="statement"]:visible').waitFor());
  await check(page, "/lojista/divulgacao", () => page.locator('[data-testid="store-qr"]:visible').waitFor());
  const [product] = await db`select p.id from products p join stores s on s.id = p.store_id where s.slug = 'pizzaria-forno-de-barro' and p.name = 'Pizza Grande (8 fatias)'`;
  await check(page, `/lojista/cardapio/produto/${product.id}`, () => page.getByRole("button", { name: "Salvar produto" }).waitFor());

  await loginAs(page, "Admin Chegô");
  await check(page, "/admin", () => page.getByRole("heading", { name: "Vendas por dia" }).waitFor());
  await check(page, "/admin/ao-vivo", () => page.locator('[data-testid="live-alerts"]:visible').waitFor());
  await check(page, "/admin/lojas", () => page.locator('[data-testid="admin-store"]:visible').first().waitFor());
  await check(page, "/admin/pedidos", () => page.locator('[data-testid="admin-order"]:visible').first().waitFor());
  await check(page, "/admin/clientes", () => page.locator('[data-testid="admin-customer"]:visible').first().waitFor());
  await check(page, "/admin/entregadores", () => page.locator('[data-testid="admin-courier"]:visible').first().waitFor());
  await check(page, "/admin/pedidos?periodo=30&situacao=vendidos", () => page.locator('[data-testid="active-filters"]:visible').waitFor());
  await check(page, "/admin/suporte", () => page.getByRole("heading", { name: "Suporte" }).waitFor());
  await check(page, "/admin/moderacao", () => page.getByRole("heading", { name: "Moderação" }).waitFor());
  await check(page, "/admin/financeiro", () => page.locator('[data-testid="reconciliation"]:visible').waitFor());
  await check(page, "/admin/marketing", () => page.getByRole("button", { name: "Publicar banner" }).waitFor());
  await check(page, "/admin/cadastros", () => page.getByRole("button", { name: "Criar plano" }).waitFor());
  await check(page, "/admin/configuracoes", () => page.getByRole("button", { name: "Salvar configurações" }).waitFor());
  await check(page, "/admin/auditoria", () => page.locator('[data-testid="audit-row"]:visible').first().waitFor());
  await check(page, "/dev", () => page.getByRole("heading", { name: "Caixa de mensagens" }).waitFor());

  // O painel do entregador da rede, com uma entrega na rua e ofertas esperando.
  await loginAs(page, "Jonas Ferreira");
  await check(page, "/entregador", () => page.locator('[data-testid="courier-offer"]:visible').first().waitFor());
});

test("painel do lojista funciona só com o teclado", async ({ page }) => {
  await loginAs(page, "Marcos Antônio Tavares");
  await page.goto("/lojista/pedidos");
  await page.getByText("Concluídos hoje").first().waitFor();

  // O Tab passa por controles de verdade, cada um com contorno de foco visível e um nome.
  const seen: string[] = [];
  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return { name: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30), outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 };
    });
    if (!info) continue;
    expect(info.outline, `Sem contorno de foco em "${info.name}"`).toBe(true);
    seen.push(info.name);
  }
  expect(seen.length).toBeGreaterThan(8);
  expect(seen).toContain("Pedidos");
});

test("segurança: cabeçalhos, cookies e o que não pode ser acessado sem permissão", async ({ page, request }) => {
  const home = await request.get("/");
  const headers = home.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  // O cookie de sessão não pode ser lido por scripts e não é enviado a partir de outros sites.
  await loginAs(page, "Ana Clara Souza");
  const session = (await page.context().cookies()).find((cookie) => cookie.name === "chego_session");
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("chego_session");

  // Sem entrar: dados privados, painéis, exportações e envios de arquivo são recusados.
  const anonymous = await (await page.context().browser()!.newContext()).newPage();
  for (const path of ["/perfil/meus-dados", "/api/push"]) {
    const response = path === "/api/push" ? await anonymous.request.put(path, { data: {} }) : await anonymous.request.get(path);
    expect(response.status(), path).toBe(401);
  }
  expect((await anonymous.request.get("/api/carrinho").then((response) => response.json())).cart).toBeNull();
  for (const path of ["/lojista/cardapio/exportar", "/lojista/relatorios/exportar", "/admin/financeiro/exportar?mes=2026-09", "/lojista/divulgacao/cartaz"]) {
    const response = await anonymous.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toContain("/entrar");
  }

  // Um cliente não consegue abrir, cancelar nem conversar no pedido de outro cliente.
  const [other] = await db`
    select o.id from orders o join profiles p on p.id = o.customer_id where p.full_name = 'Bruno Henrique Lima' order by o.created_at desc limit 1`;
  for (const path of [`/pedidos/${other.id}`, `/pedidos/${other.id}/pagamento`, `/pedidos/${other.id}/ajuda`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();
  }

  // Texto digitado por usuários é mostrado como texto, nunca executado como código.
  await chooseNeighborhood(anonymous, "Centro");
  await anonymous.goto("/busca?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  await expect(anonymous.getByText("Oxe, não achamos nada com “<img src=x onerror=alert(1)>”.")).toBeVisible();
  expect(await anonymous.locator("img[src='x']").count()).toBe(0);
  await anonymous.context().close();

  // O webhook é público, então recusa tudo o que não vier assinado.
  expect((await request.post("/api/webhooks/pagamentos", { data: { id: "x", type: "payment.approved", data: { payment_id: "y" } } })).status()).toBe(401);
});
