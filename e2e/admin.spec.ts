import { expect, test, type Page } from "@playwright/test";
import { chooseNeighborhood, db, loginAs, placePaidOrder, setClock, visible } from "./helpers";

// A Friday at 20h: the burger place and the açaí shop are open.
test.beforeAll(() => setClock("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

const ADMIN = "Admin Chegô";
const storeId = async (slug: string) => (await db`select id from stores where slug = ${slug}`)[0].id as string;
const stat = (page: Page, label: string) => page.locator('[data-testid="stat"]:visible').filter({ hasText: label }).first();

test("painel geral mostra os números do período e só o admin entra", async ({ page }) => {
  await loginAs(page, ADMIN);
  await expect(page.getByRole("heading", { name: "Oi, Admin Chegô!" })).toBeVisible();

  const to = new Date("2026-10-09T20:00:00-03:00");
  const [expected] = await db`
    select count(*)::int as orders, coalesce(sum(total_cents - refunded_cents), 0)::int as gmv from orders
    where paid_at is not null and status not in ('rejected', 'cancelled', 'refunded', 'expired')
      and paid_at >= ${new Date(to.getTime() - 30 * 86_400_000)} and paid_at < ${to}`;
  await page.goto("/admin?periodo=30");
  await expect(stat(page, "Pedidos")).toContainText(String(expected.orders));
  await expect(stat(page, "Lojas abertas agora")).toContainText(/\d+ de \d+/);
  await expect(page.getByRole("link", { name: /1 loja esperando aprovação/ })).toBeVisible();

  // Each one ends where their own role lives; the URL is checked after the redirects settle.
  const landing: [string, RegExp][] = [["Ana Clara Souza", /\/$/], ["Marcos Antônio Tavares", /\/boas-vindas$/]];
  for (const [who, home] of landing) {
    await loginAs(page, who);
    for (const path of ["/admin", "/admin/lojas", "/admin/financeiro", "/admin/auditoria"]) {
      await page.goto(path);
      await expect(page).toHaveURL(home);
    }
  }
});

test("aprovar loja pendente exige o checklist e coloca a loja no ar", async ({ page, browser }) => {
  const customer = await (await browser.newContext()).newPage();
  await customer.goto("/loja/espetinho-do-ze");
  await expect(customer.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();

  await loginAs(page, ADMIN);
  await page.goto("/admin/lojas?situacao=pending");
  await page.locator('[data-testid="admin-store"]:visible').filter({ hasText: "Espetinho do Zé" }).click();
  await expect(visible(page, "admin-store-status")).toHaveText("Pendente");

  await page.getByRole("button", { name: "Aprovar e colocar no ar" }).click();
  await expect(page.getByText(/^Falta conferir:/)).toBeVisible();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Aprovar e colocar no ar" }).click();
  await expect(visible(page, "admin-store-status")).toHaveText("Ativa");

  await customer.goto("/loja/espetinho-do-ze");
  await expect(customer.getByRole("heading", { name: "Espetinho do Zé" })).toBeVisible();
  await customer.context().close();
  expect((await db`select count(*)::int as total from audit_logs where action = 'store.approve'`)[0].total).toBe(1);
  expect((await db`select count(*)::int as total from outbound_messages where body like '%já aparece para os clientes%'`)[0].total).toBeGreaterThan(0);
});

test("mudar a comissão vale para pedidos novos; os antigos não mudam", async ({ page }) => {
  const id = await storeId("brasa-burger");
  const [old] = await db`select id, commission_rate, commission_cents from orders where store_id = ${id} and status = 'delivered' order by created_at limit 1`;
  expect(old.commission_rate).toBe("0.1200");

  await loginAs(page, ADMIN);
  await page.goto(`/admin/lojas/${id}`);
  await page.getByLabel("Comissão (%)").fill("15");
  await page.getByRole("button", { name: "Salvar condições" }).click();
  await expect(page.getByText("Condições da loja salvas.")).toBeVisible();

  const orderId = await placePaidOrder(page, "Ana Clara Souza", "brasa-burger", ["Batata com cheddar e bacon"]);
  const [fresh] = await db`select commission_rate, commission_cents, subtotal_cents from orders where id = ${orderId}`;
  expect(fresh).toEqual({ commission_rate: "0.1500", commission_cents: 360, subtotal_cents: 2400 });
  expect((await db`select commission_rate, commission_cents from orders where id = ${old.id}`)[0]).toEqual({
    commission_rate: "0.1200", commission_cents: old.commission_cents,
  });
  const [log] = await db`select details from audit_logs where action = 'store.terms' and entity_id = ${id} order by created_at desc limit 1`;
  expect(log.details).toMatchObject({ commissionBefore: 0.12, commissionAfter: 0.15 });
});

test("destaque pago aparece identificado; suspender tira a loja do ar", async ({ page, browser }) => {
  const id = await storeId("acai-tropical");
  await loginAs(page, ADMIN);
  await page.goto(`/admin/lojas/${id}`);
  await page.getByLabel("Destaque pago até").fill("2026-12-31");
  await page.getByRole("button", { name: "Salvar condições" }).click();
  await expect(page.getByText("Condições da loja salvas.")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Centro");
  const featured = customer.locator("section", { has: customer.getByRole("heading", { name: "Destaques" }) });
  await expect(featured.getByTestId("store-card").filter({ hasText: "Açaí Tropical" })).toHaveCount(1);

  await page.getByLabel("Nova situação").selectOption("suspended");
  await page.getByRole("button", { name: "Alterar situação" }).click();
  await expect(page.getByText("Para suspender, escreva o motivo.")).toBeVisible();
  await page.getByLabel("Motivo").fill("Teste de suspensão");
  await page.getByRole("button", { name: "Alterar situação" }).click();
  await expect(visible(page, "admin-store-status")).toHaveText("Suspensa");

  await customer.goto("/loja/acai-tropical");
  await expect(customer.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();
  await customer.context().close();

  await page.getByLabel("Nova situação").selectOption("active");
  await page.getByRole("button", { name: "Alterar situação" }).click();
  await expect(visible(page, "admin-store-status")).toHaveText("Ativa");
});

test("ver como a loja é somente leitura e fica registrado", async ({ page }) => {
  const id = await storeId("mercado-boa-compra");
  await loginAs(page, ADMIN);
  await page.goto(`/admin/lojas/${id}`);
  await page.getByRole("link", { name: "Ver como esta loja" }).click();
  const view = visible(page, "view-as-store");
  await expect(view).toContainText("somente leitura");
  await expect(view.getByRole("button")).toHaveCount(0);
  expect((await db`select count(*)::int as total from audit_logs where action = 'store.view_as' and entity_id = ${id}`)[0].total).toBeGreaterThan(0);
});

test("pedidos: buscar, reembolsar em parte e depois o resto", async ({ page }) => {
  const [order] = await db`
    select o.id, o.code, o.total_cents, o.store_amount_cents from orders o
    where o.status = 'delivered' and o.refunded_cents = 0 and o.total_cents > 3000 order by o.created_at desc limit 1`;

  await loginAs(page, ADMIN);
  await page.goto("/admin/pedidos");
  await page.getByRole("searchbox").fill(order.code);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.locator('[data-testid="admin-order"]:visible')).toHaveCount(1);
  await page.locator('[data-testid="admin-order"]:visible').click();

  await page.getByLabel("Valor do reembolso parcial (R$)").fill("10,00");
  // The reason is a required field: without it the form does not even go.
  await expect(page.getByLabel("Motivo").first()).toHaveAttribute("required", "");
  await page.getByLabel("Motivo").first().fill("Item chegou frio");
  await page.getByRole("button", { name: "Reembolsar", exact: true }).click();
  await expect(visible(page, "admin-order-status")).toHaveText("Reembolsado em parte");
  await expect(visible(page, "admin-refunded")).toHaveText("R$ 10,00");

  const [refund] = await db`select store_share_cents, platform_share_cents, reason from refunds where order_id = ${order.id}`;
  expect(refund.store_share_cents + refund.platform_share_cents).toBe(1000);
  expect(refund.store_share_cents).toBe(Math.round((1000 * order.store_amount_cents) / order.total_cents));
  expect(refund.reason).toBe("Item chegou frio");

  await page.getByRole("radio", { name: "Reembolso total" }).check();
  await page.getByLabel("Motivo").first().fill("Cliente não recebeu");
  await page.getByRole("button", { name: "Reembolsar", exact: true }).click();
  await expect(visible(page, "admin-order-status")).toHaveText("Reembolsado");
  const [after] = await db`
    select o.refunded_cents, o.total_cents,
      (select sum(case when direction = 'credit' then amount_cents else -amount_cents end)::int from ledger_entries where order_id = o.id) as net
    from orders o where o.id = ${order.id}`;
  expect(after.refunded_cents).toBe(after.total_cents);
  expect(after.net).toBe(0);
  expect((await db`select count(*)::int as total from audit_logs where entity_id = ${order.id} and action like 'order.refund%'`)[0].total).toBe(2);
});

test("alterar situação de um pedido em caso excepcional exige motivo e fica no log", async ({ page }) => {
  const [order] = await db`select id from orders where status = 'preparing' limit 1`;
  await loginAs(page, ADMIN);
  await page.goto(`/admin/pedidos/${order.id}`);
  await page.getByLabel("Nova situação").selectOption("ready");
  await page.getByLabel("Motivo").last().fill("Loja sem internet, avisou por telefone");
  await page.getByRole("button", { name: "Alterar situação" }).click();
  await expect(visible(page, "admin-order-status")).toHaveText("Pronto");
  const [log] = await db`select details from audit_logs where action = 'order.force_status' and entity_id = ${order.id}`;
  expect(log.details).toMatchObject({ from: "preparing", to: "ready" });
});

test("bloquear e desbloquear cliente", async ({ page }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/clientes?q=Diego");
  await page.locator('[data-testid="admin-customer"]:visible').filter({ hasText: "Diego Alves" }).click();
  await page.getByLabel("Motivo do bloqueio").fill("Teste de bloqueio");
  await page.getByRole("button", { name: "Bloquear", exact: true }).click();
  await expect(visible(page, "blocked-note")).toContainText("Teste de bloqueio");
  expect((await db`select blocked_at is not null as blocked from profiles where full_name = 'Diego Alves'`)[0].blocked).toBe(true);

  await page.getByRole("button", { name: "Desbloquear" }).click();
  await expect(visible(page, "blocked-note")).toHaveCount(0);
});

test("suporte: admin responde o chamado, aciona a loja e reembolsa em parte", async ({ page, browser }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/suporte");
  await page.locator('[data-testid="admin-ticket"]:visible').filter({ hasText: "Gabriela Nunes" }).click();
  await expect(page.getByText("O sabão em pó não veio na sacola, mas foi cobrado.")).toBeVisible();

  await page.getByLabel("Responder ao cliente").fill("Oi, Gabriela! Vamos devolver o valor do sabão em pó.");
  await page.getByLabel("Situação do chamado").selectOption("waiting_customer");
  await page.getByLabel(/Acionar a loja/).check();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Chamado atualizado.")).toBeVisible();

  await page.getByRole("link", { name: /Abrir o pedido/ }).click();
  await page.getByLabel("Valor do reembolso parcial (R$)").fill("12,90");
  await page.getByLabel("Motivo").first().fill("Item faltando: sabão em pó");
  await page.getByRole("button", { name: "Reembolsar", exact: true }).click();
  await expect(visible(page, "admin-refunded")).toHaveText("R$ 12,90");

  const customer = await (await browser.newContext()).newPage();
  await loginAs(customer, "Gabriela Nunes");
  const [ticket] = await db`
    select t.order_id, t.status, t.store_involved from support_tickets t join profiles p on p.id = t.customer_id where p.full_name = 'Gabriela Nunes'`;
  expect(ticket).toMatchObject({ status: "waiting_customer", store_involved: true });
  await customer.goto(`/pedidos/${ticket.order_id}/ajuda`);
  await expect(customer.getByText("Oi, Gabriela! Vamos devolver o valor do sabão em pó.")).toBeVisible();
  await expect(customer.locator('[data-testid="ticket-status"]:visible')).toHaveText("Aguardando você");
  await customer.goto(`/pedidos/${ticket.order_id}`);
  await expect(customer.locator('[data-testid="refund-note"]:visible')).toHaveText("Devolvemos R$ 12,90 para você.");
  await customer.context().close();
});

test("moderação: avaliação oculta volta e é ocultada de novo; tentativas de contato aparecem", async ({ page }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/moderacao");
  await expect(page.locator('[data-testid="blocked-attempt"]:visible').filter({ hasText: "Me chama no zap" }).first()).toContainText("bloqueado por telefone");

  const review = page.locator('[data-testid="moderation-review"]:visible').first();
  await expect(review).toContainText("Oculta");
  const [before] = await db`select r.store_id, s.rating_count from reviews r join stores s on s.id = r.store_id where r.hidden_at is not null`;
  await review.getByRole("button", { name: "Mostrar de novo" }).click();
  await expect(review.getByText("Oculta", { exact: true })).toHaveCount(0);
  expect((await db`select rating_count from stores where id = ${before.store_id}`)[0].rating_count).toBe(before.rating_count + 1);

  await review.getByLabel("Motivo para ocultar").fill("Palavrões");
  await review.getByRole("button", { name: "Ocultar avaliação" }).click();
  await expect(review).toContainText("Motivo: Palavrões");
  expect((await db`select rating_count from stores where id = ${before.store_id}`)[0].rating_count).toBe(before.rating_count);
});

test("financeiro: comissões por loja, CSV do contador e conciliação que acusa diferença", async ({ page }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/financeiro?mes=2026-09");
  await expect(visible(page, "commissions")).toContainText("Pizzaria Forno de Barro");
  await expect(visible(page, "reconciliation")).toContainText("Tudo confere");

  const csv = await page.request.get("/admin/financeiro/exportar?mes=2026-09");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text).toMatch(/^﻿mes;loja;documento;pedidos;vendas;comissao;taxa_de_servico;mensalidade;total_a_faturar/);
  expect(text).toContain('2026-09;"Pizzaria Forno de Barro"');

  // The gateway "charged" a different amount for one order: the reconciliation must point at it.
  const [payment] = await db`
    select p.id, p.amount_cents, o.code from payments p join orders o on o.id = p.order_id
    where p.status = 'approved' and o.paid_at >= '2026-09-01T03:00:00Z' and o.paid_at < '2026-10-01T03:00:00Z' limit 1`;
  await db`update payments set amount_cents = amount_cents + 100 where id = ${payment.id}`;
  try {
    await page.reload();
    const box = visible(page, "reconciliation");
    await expect(box).toContainText("1 diferença");
    await expect(box).toContainText(`${payment.code}`);
    await expect(box).toContainText("valor cobrado diferente do total do pedido");
  } finally {
    await db`update payments set amount_cents = ${payment.amount_cents} where id = ${payment.id}`;
  }
});

test("marketing: banner novo aparece no início e cupom da plataforma funciona", async ({ page, browser }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/marketing");
  await page.getByLabel("Título do banner").fill("Banner de teste do admin");
  await page.getByLabel("Link ao tocar (opcional)").fill("/loja/brasa-burger");
  await page.locator('input[name="image"]:visible').setInputFiles("storage/banners/sexta-da-pizza.webp");
  await page.getByRole("button", { name: "Publicar banner" }).click();
  await expect(page.locator('[data-testid="admin-banner"]:visible').filter({ hasText: "Banner de teste do admin" })).toHaveCount(1);

  await page.getByLabel("Código").fill("teste7");
  await page.getByLabel("Valor do desconto (R$)").fill("7,00");
  await page.getByRole("button", { name: "Criar cupom" }).click();
  await expect(page.locator('[data-testid="admin-coupon"]:visible').filter({ hasText: "TESTE7" })).toContainText("pago pela plataforma");

  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Centro");
  await expect(customer.getByRole("img", { name: "Banner de teste do admin" })).toBeVisible();
  await customer.context().close();
});

test("cadastros: bairro novo aparece para o cliente e manutenção fecha a cidade", async ({ page, browser }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/cadastros");
  await page.locator('select[name="cityId"]:visible').selectOption({ label: "Joaquim Gomes" });
  await page.getByLabel("Novo bairro ou comunidade").fill("Bairro de Teste");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Bairro ou comunidade adicionado.")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Bairro de Teste");
  await expect(customer.locator('[data-testid="current-location"]:visible')).toHaveText("Bairro de Teste, Joaquim Gomes");

  await page.getByRole("button", { name: "Sem manutenção: Joaquim Gomes" }).click();
  await expect(page.getByRole("button", { name: "Em manutenção: Joaquim Gomes" })).toBeVisible();
  await customer.reload();
  await expect(customer.locator('[data-testid="maintenance"]:visible')).toContainText("Estamos arrumando a casa em Joaquim Gomes.");

  await page.getByRole("button", { name: "Em manutenção: Joaquim Gomes" }).click();
  await expect(page.getByRole("button", { name: "Sem manutenção: Joaquim Gomes" })).toBeVisible();
  await customer.reload();
  await expect(customer.getByRole("heading", { name: "Abertas agora" })).toBeVisible();
  await customer.context().close();
});

test("configurações: taxa de serviço nova vale no carrinho; recursos ligam e desligam", async ({ page, browser }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/configuracoes");
  await page.getByLabel("Taxa de serviço por pedido (R$)").fill("1,50");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas.")).toBeVisible();

  try {
    const customer = await (await browser.newContext()).newPage();
    await chooseNeighborhood(customer, "Centro");
    const [product] = await db`select p.id from products p join stores s on s.id = p.store_id where s.slug = 'brasa-burger' and p.name = 'Batata com cheddar e bacon'`;
    await customer.goto(`/loja/brasa-burger/produto/${product.id}`);
    await customer.getByRole("button", { name: /^Adicionar/ }).click();
    await customer.waitForURL(/\/loja\/brasa-burger$/);
    await customer.goto("/carrinho");
    // 24,00 + 3,00 de entrega + 1,50 de taxa de serviço.
    await expect(customer.locator('[data-testid="summary-total"]:visible')).toHaveText("R$ 28,50");
    await customer.context().close();
  } finally {
    await db`update platform_settings set value = '99' where key = 'service_fee_cents'`;
  }

  const flag = page.locator('[data-testid="admin-flag"]:visible').filter({ hasText: "Pagamento com cartão de crédito" });
  await flag.getByRole("button").click();
  await expect(flag.getByRole("button")).toHaveText("Desligado");
  await flag.getByRole("button").click();
  await expect(flag.getByRole("button")).toHaveText("Ligado");
});

test("publicar nova versão dos termos obriga todo mundo a aceitar de novo", async ({ page, browser }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/configuracoes");
  await page.getByLabel("Documento").selectOption("privacy");
  await page.getByLabel("Título").fill("Política de Privacidade");
  await page.getByLabel("Texto completo").fill("[TEXTO PROVISÓRIO] Política de Privacidade, versão 2, publicada pelo teste.");
  await page.getByRole("button", { name: "Publicar nova versão" }).click();

  try {
    // The admin too, on the very next page.
    await expect.poll(async () => (await db`select count(*)::int as total from legal_documents where type = 'privacy' and version = 2`)[0].total).toBe(1);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/termos\/aceitar$/);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Aceitar e continuar" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const customer = await (await browser.newContext()).newPage();
    await loginAs(customer, "Felipe Rocha");
    await customer.goto("/pedidos");
    await expect(customer).toHaveURL(/\/termos\/aceitar$/);
    await customer.context().close();
  } finally {
    await db`delete from legal_acceptances where document_id in (select id from legal_documents where type = 'privacy' and version = 2)`;
    await db`delete from legal_documents where type = 'privacy' and version = 2`;
  }
});

test("log de auditoria lista as ações e filtra por tipo", async ({ page }) => {
  await loginAs(page, ADMIN);
  await page.goto("/admin/auditoria");
  await expect(page.locator('[data-testid="audit-row"]:visible').first()).toBeVisible();
  await page.getByLabel("Ação").selectOption("customer.block");
  await page.getByRole("button", { name: "Filtrar" }).click();
  const rows = page.locator('[data-testid="audit-row"]:visible');
  await expect(rows.first()).toContainText("customer.block");
  for (const text of await rows.allTextContents()) expect(text).toContain("customer.block");
});

test("pedidos ao vivo avisam quando a loja não aceita", async ({ page }) => {
  await loginAs(page, ADMIN);
  // A day later, the seeded paid order at the pizzaria has clearly waited too long.
  await setClock("2026-10-10T20:00");
  try {
    await page.goto("/admin/ao-vivo");
    await expect(visible(page, "live-alerts")).toContainText("precisando de atenção");
    await expect(page.locator('[data-testid="live-order"]:visible').filter({ hasText: /Sem aceite há/ }).first()).toBeVisible();
  } finally {
    await setClock("2026-10-09T20:00");
  }
});
