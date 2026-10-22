import { expect, test } from "@playwright/test";
import { chooseNeighborhood, db, freshDatabase, loginAs, setClock, visible } from "./helpers";

// Super admin: painel, suspensão, exclusão, anúncios, avaliações e permissões, pelo navegador.
// Uma sexta às 20h: a hamburgueria está aberta.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

const SUPER = "Admin Chegô";
const SUPPORT = "Suporte Chegô"; // admin comum
const storeBySlug = async (slug: string) => (await db`select id, name, owner_id from stores where slug = ${slug}`)[0] as { id: string; name: string; owner_id: string };

test("painel: indicadores batem com o banco no período e todas as telas do menu abrem", async ({ page }) => {
  await loginAs(page, SUPER);
  await page.goto("/admin?periodo=ano");
  const [expected] = await db`
    select (select count(*)::int from orders where created_at >= '2026-01-01T00:00:00-03:00' and created_at < '2026-10-09T20:00:00-03:00') as orders,
           (select coalesce(sum(total_cents - refunded_cents), 0)::int from orders where paid_at is not null and status not in ('rejected', 'cancelled', 'refunded', 'expired')
              and paid_at >= '2026-01-01T00:00:00-03:00' and paid_at < '2026-10-09T20:00:00-03:00') as sales`;
  await expect(visible(page, "kpi-orders")).toContainText(expected.orders.toLocaleString("pt-BR"));
  await expect(visible(page, "kpi-sales")).toContainText((expected.sales / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  await expect(visible(page, "range-label")).toContainText("Este ano");
  // Clicar no número abre a lista com o mesmo recorte.
  await visible(page, "kpi-orders").click();
  await expect(visible(page, "list-summary")).toContainText(`${expected.orders} pedido`);

  for (const [path, heading] of [
    ["/admin/lojas", "Lojas"], ["/admin/empresas", "Empresas"], ["/admin/pedidos", "Pedidos"], ["/admin/vendas", "Vendas e faturamento"],
    ["/admin/motoboys", "Motoboys"], ["/admin/anuncios", "Anúncios e impulsionamentos"], ["/admin/avaliacoes", "Avaliações"],
    ["/admin/suspensas", "Contas suspensas"], ["/admin/excluidas", "Empresas excluídas"], ["/admin/relatorios", "Relatórios de empresas"],
    ["/admin/auditoria", "Auditoria"], ["/admin/configuracoes", "Configurações"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
});

test("suspensão com prazo, histórico e reativação; exclusão com confirmação preserva os pedidos", async ({ page }) => {
  const store = await storeBySlug("acai-tropical");
  await loginAs(page, SUPER);
  await page.goto(`/admin/lojas/${store.id}`);
  await page.getByTestId("suspend-open").click();
  const dialog = page.getByRole("dialog", { name: /Suspender/ });
  await dialog.getByLabel("Motivo da suspensão").fill("Reclamações repetidas");
  await dialog.getByLabel("Descrição da ocorrência").fill("Três pedidos não entregues na semana.");
  await dialog.getByLabel("Até").fill("2026-10-20T12:00");
  await dialog.getByRole("button", { name: "Suspender conta" }).click();
  // A tela se atualiza: o botão "Suspender" some e aparece o aviso da suspensão.
  await expect(page.getByTestId("open-suspension")).toContainText("Reclamações repetidas");
  const [suspension] = await db`select reason, ends_at, applied_at from store_suspensions where store_id = ${store.id} and lifted_at is null`;
  expect(suspension.reason).toBe("Reclamações repetidas");
  expect(suspension.ends_at.toISOString()).toBe("2026-10-20T15:00:00.000Z");

  await page.goto("/admin/suspensas");
  await expect(page.getByTestId("suspension").filter({ hasText: store.name })).toContainText("Reclamações repetidas");

  await page.goto(`/admin/lojas/${store.id}`);
  await page.getByRole("button", { name: "Reativar conta" }).click();
  const reactivate = page.getByRole("dialog", { name: "Reativar conta" });
  await reactivate.getByLabel("Motivo da reativação").fill("Loja regularizou as entregas");
  await reactivate.getByRole("button", { name: "Reativar" }).click();
  await expect(page.getByTestId("open-suspension")).toHaveCount(0);
  await page.reload();
  await page.getByText(/Histórico de situação/).click();
  await expect(page.getByTestId("status-history")).toContainText("Reativada");
  await expect(page.getByTestId("status-history")).toContainText("Suspensa");

  // Exclusão: confirma digitando o nome; pedidos continuam.
  const [target] = await db`
    select s.id, s.name from stores s where s.status = 'active' and s.closed_at is null
      and not exists (select 1 from orders o where o.store_id = s.id and o.status in ('awaiting_payment', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery'))
      and exists (select 1 from orders o where o.store_id = s.id) and s.slug <> 'acai-tropical' order by s.name limit 1`;
  const orders = (await db`select count(*)::int as n from orders where store_id = ${target.id}`)[0].n;
  await page.goto(`/admin/lojas/${target.id}`);
  await page.getByTestId("delete-open").click();
  const remove = page.getByRole("dialog", { name: "Excluir conta" });
  await remove.getByLabel("Motivo").fill("Fraude comprovada");
  await remove.getByLabel(/Digite o nome da loja/).fill("nome errado");
  await remove.getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(remove.getByText(/digite o nome da loja exatamente/)).toBeVisible();
  await remove.getByLabel(/Digite o nome da loja/).fill(target.name);
  await remove.getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(page.getByTestId("account-panel")).toContainText("Excluída pelo Chegô");
  expect((await db`select count(*)::int as n from orders where store_id = ${target.id}`)[0].n).toBe(orders);
  await page.goto("/admin/excluidas?por=admin");
  await expect(page.getByTestId("closed-stores")).toContainText(target.name);
  await expect(page.getByTestId("closed-stores")).toContainText("Fraude comprovada");
});

test("anúncio nas primeiras posições aparece como Patrocinado, conta impressão e clique, e pausar tira do ar", async ({ page, browser }) => {
  const store = await storeBySlug("brasa-burger");
  await loginAs(page, SUPER);
  await page.goto("/admin/anuncios");
  const form = page.locator("details", { hasText: "Nova campanha" });
  await form.locator("summary").click();
  await form.locator('select[name="storeId"]').selectOption(store.id);
  await form.getByLabel("Nome da campanha").fill("Semana do burger");
  await form.getByLabel("Onde aparece").selectOption("topo");
  await form.getByLabel("Valor cobrado (R$)").fill("150,00");
  await form.getByRole("button", { name: "Criar campanha" }).click();
  await expect(page.getByTestId("campaign").filter({ hasText: "Semana do burger" })).toContainText("No ar");
  const [campaign] = await db`select id from ad_campaigns where title = 'Semana do burger'`;

  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Centro");
  const open = customer.locator("section", { has: customer.getByRole("heading", { name: "Abertas agora" }) });
  const first = open.getByTestId("store-card").first();
  await expect(first).toContainText(store.name);
  await expect(first.getByTestId("sponsored-badge")).toHaveText("Patrocinado");
  // A loja aparece uma vez só na lista.
  await expect(open.getByTestId("store-card").filter({ hasText: store.name })).toHaveCount(1);
  await expect.poll(async () => (await db`select coalesce(sum(impressions), 0)::int as n from ad_daily_stats where campaign_id = ${campaign.id}`)[0].n).toBeGreaterThan(0);

  await first.click();
  await customer.waitForURL(/\/loja\/brasa-burger$/);
  expect((await db`select coalesce(sum(clicks), 0)::int as n from ad_daily_stats where campaign_id = ${campaign.id}`)[0].n).toBe(1);
  // A nota da loja não muda por causa do anúncio.
  const [rating] = await db`select rating_avg from stores where id = ${store.id}`;
  await customer.context().close();
  expect((await db`select rating_avg from stores where id = ${store.id}`)[0].rating_avg).toBe(rating.rating_avg);

  // Pausar tira do ar na hora.
  await page.reload();
  const card = page.getByTestId("campaign").filter({ hasText: "Semana do burger" });
  await card.getByRole("button", { name: "Pausar" }).click();
  // Pausada, sai de "No ar agora" e da vitrine.
  await expect(card).toHaveCount(0);
  expect((await db`select status::text from ad_campaigns where id = ${campaign.id}`)[0].status).toBe("pausada");
});

test("avaliações: corrigir nota exige motivo e confirmação e fica no histórico e na auditoria", async ({ page }) => {
  const [review] = await db`
    select r.id, r.rating, r.store_id from reviews r where r.hidden_at is null and r.rating <= 4 order by r.created_at desc limit 1`;
  await loginAs(page, SUPER);
  await page.goto(`/admin/avaliacoes?loja=${review.store_id}`);
  const item = page.getByTestId("admin-review").filter({ has: page.locator(`text=/pedido/`) }).first();
  await expect(item).toBeVisible();

  const rows = page.getByTestId("admin-review");
  const count = await rows.count();
  let target = rows.first();
  for (let index = 0; index < count; index += 1) {
    const html = await rows.nth(index).innerHTML();
    if (html.includes(review.id)) target = rows.nth(index);
  }
  // Pela ordem (mais recentes primeiro), a avaliação escolhida é a primeira da loja com nota até 4.
  await target.getByRole("button", { name: "Corrigir erro técnico" }).click();
  const dialog = page.getByRole("dialog", { name: "Corrigir erro técnico na nota" });
  await dialog.getByLabel("Nota correta").selectOption("5");
  await dialog.getByLabel("Motivo e comprovação").fill("Falha no app gravou a nota errada (chamado 123)");
  await dialog.getByRole("button", { name: "Corrigir nota" }).click();
  await expect(dialog.getByText("Confirme que é a correção de um erro técnico comprovado.")).toBeVisible();
  await dialog.getByLabel("É a correção de um erro técnico comprovado").check();
  await dialog.getByRole("button", { name: "Corrigir nota" }).click();
  await expect(dialog.getByText(/Nota corrigida/)).toBeVisible();

  const [event] = await db`select old_rating, new_rating, reason from review_events e join reviews r on r.id = e.review_id where r.store_id = ${review.store_id} and e.action = 'nota_corrigida'`;
  expect(event.new_rating).toBe(5);
  expect(event.reason).toContain("chamado 123");
  const [audited] = await db`select details from audit_logs where action = 'avaliacao.nota_corrigida' order by created_at desc limit 1`;
  expect(audited.details).toMatchObject({ depois: 5 });
});

test("admin comum vê o painel, mas não suspende, não anuncia e não corrige notas", async ({ page }) => {
  const store = await storeBySlug("pizzaria-forno-de-barro");
  await loginAs(page, SUPPORT);
  await page.goto("/admin");
  await expect(page.getByText("Admin: você vê o painel")).toBeVisible();
  await page.goto(`/admin/lojas/${store.id}`);
  await expect(page.getByTestId("account-panel")).toContainText("Só o super admin");
  await expect(page.getByTestId("suspend-open")).toHaveCount(0);
  await page.goto("/admin/anuncios");
  await expect(page.getByText("Só o super admin cria e altera campanhas.")).toBeVisible();
  await page.goto("/admin/avaliacoes");
  await expect(page.getByRole("button", { name: "Corrigir erro técnico" })).toHaveCount(0);
});

test("a empresa encerra a própria loja: some do painel do lojista e aparece em Empresas excluídas", async ({ page }) => {
  const [store] = await db`
    select s.id, s.name, p.full_name as owner from stores s join profiles p on p.id = s.owner_id
    where s.slug = 'emporio-vida-verde'`;
  await db`update orders set status = 'delivered', completed_at = now() where store_id = ${store.id} and status in ('paid', 'accepted', 'preparing', 'ready', 'out_for_delivery')`;
  await loginAs(page, store.owner);
  await page.goto("/lojista/loja");
  await page.getByRole("button", { name: "Encerrar a loja" }).click();
  const dialog = page.getByRole("dialog", { name: "Encerrar a loja" });
  await dialog.getByLabel("Por que está saindo?").fill("Vamos fechar o ponto");
  await dialog.getByLabel(/Digite o nome da loja/).fill(store.name);
  await dialog.getByRole("button", { name: "Encerrar definitivamente" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  const [after] = await db`select closed_by_kind, closed_reason from stores where id = ${store.id}`;
  expect(after).toEqual({ closed_by_kind: "empresa", closed_reason: "Vamos fechar o ponto" });

  await loginAs(page, SUPER);
  await page.goto("/admin/excluidas?por=empresa");
  await expect(page.getByTestId("closed-stores")).toContainText(store.name);
});
