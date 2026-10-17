import { expect, test, type APIRequestContext } from "@playwright/test";
import { chooseNeighborhood, db, loginAs, loginWithPhone, placePaidOrder, setClock, visible, freshDatabase } from "./helpers";

// Este arquivo roda por último (ordem alfabética): adiantar o relógio aqui
// expira e recusa o que os outros arquivos deixaram em aberto.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

async function runTasks(request: APIRequestContext) {
  const response = await request.post("/api/tarefas");
  expect(response.status()).toBe(200);
  return (await response.json()).report as Record<string, number>;
}

test("nova loja se cadastra, admin aprova e ela aparece para os clientes", async ({ page, browser }) => {
  await page.goto("/quero-vender");
  await page.getByLabel("Nome da loja").fill("Tapiocaria da Praça");
  await page.getByLabel("O que a loja vende? (uma frase)").fill("Tapiocas doces e salgadas.");
  await page.getByLabel("Categoria").selectOption({ label: "Lanches" });
  await page.getByLabel("Cidade e bairro da loja").selectOption({ label: "Centro" });
  await page.getByLabel("Rua").fill("Praça da Matriz");
  await page.getByLabel("Nome do responsável").fill("Socorro Tapioqueira");
  await page.getByLabel("Telefone com DDD").fill("(82) 95555-0001");
  await page.getByLabel("Crie uma senha").fill("senha-da-socorro");
  await page.getByLabel("Número do documento").fill("123.456.789-0");
  await page.getByRole("button", { name: "Enviar cadastro" }).click();
  await expect(page.getByText("O CPF tem 11 números.")).toBeVisible();

  await page.getByLabel("Número do documento").fill("123.456.789-09");
  await page.getByRole("button", { name: "Enviar cadastro" }).click();
  await expect(page.getByText("Para continuar, aceite os Termos do Lojista.")).toBeVisible();
  // O que foi digitado continua lá depois dos erros.
  await expect(page.getByLabel("Nome da loja")).toHaveValue("Tapiocaria da Praça");

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enviar cadastro" }).click();
  await expect(page.getByText(/Recebemos o cadastro da Tapiocaria da Praça!/)).toBeVisible();

  const [store] = await db`
    select s.id, s.slug, s.status, sp.document_number, sp.commission_rate from stores s join store_private sp on sp.store_id = s.id
    where s.name = 'Tapiocaria da Praça'`;
  expect(store).toMatchObject({ slug: "tapiocaria-da-praca", status: "pending", document_number: "12345678909", commission_rate: "0.1000" });

  // Invisível para os clientes enquanto estiver pendente.
  await page.goto("/loja/tapiocaria-da-praca");
  await expect(page.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();

  // O dono já consegue entrar e chegar ao painel.
  const owner = await (await browser.newContext()).newPage();
  await loginWithPhone(owner, "(82) 95555-0001", "senha-da-socorro");
  await owner.getByRole("checkbox").check();
  await owner.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(owner).toHaveURL(/\/lojista\/pedidos$/);
  await expect(owner.getByText("Tapiocaria da Praça").first()).toBeVisible();
  await owner.context().close();

  await loginAs(page, "Admin Chegô");
  await page.goto(`/admin/lojas/${store.id}`);
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Aprovar e colocar no ar" }).click();
  await expect(visible(page, "admin-store-status")).toHaveText("Ativa");

  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Centro");
  await customer.goto("/loja/tapiocaria-da-praca");
  await expect(customer.getByRole("heading", { name: "Tapiocaria da Praça" })).toBeVisible();
  await customer.goto("/categoria/lanches");
  await expect(customer.locator('[data-testid="store-card"]:visible').filter({ hasText: "Tapiocaria da Praça" })).toHaveCount(1);
  await customer.context().close();
});

test("pedido sem aceite: alerta aos 8 minutos e recusa automática aos 15", async ({ page, request }) => {
  const orderId = await placePaidOrder(page, "Felipe Rocha", "brasa-burger", ["Batata com cheddar e bacon"]);
  const noAccept = async () => (await db`select count(*)::int as total from notifications where order_id = ${orderId} and type = 'order_no_accept'`)[0].total;

  await setClock("2026-10-09T20:05");
  await runTasks(request);
  expect(await noAccept()).toBe(0);
  expect((await db`select status from orders where id = ${orderId}`)[0].status).toBe("paid");

  await setClock("2026-10-09T20:10");
  await runTasks(request);
  expect(await noAccept()).toBe(1);
  // Rodar de novo não avisa duas vezes.
  await runTasks(request);
  expect(await noAccept()).toBe(1);
  expect((await db`select count(*)::int as total from outbound_messages where channel = 'sms' and body like '%esperando aceite%'`)[0].total).toBeGreaterThan(0);

  await setClock("2026-10-09T20:17");
  const report = await runTasks(request);
  expect(report.recusas_automaticas).toBeGreaterThanOrEqual(1);

  const [order] = await db`select status, refunded_cents, total_cents from orders where id = ${orderId}`;
  expect(order.status).toBe("rejected");
  // Pagando direto à loja, nada foi cobrado pelo app: não há reembolso a fazer.
  expect(order.refunded_cents).toBe(0);
  const [history] = await db`select reason, changed_by from order_status_history where order_id = ${orderId} and status = 'rejected'`;
  expect(history).toEqual({ reason: "A loja não respondeu a tempo", changed_by: null });
  expect((await db`select count(*)::int as total from notifications where order_id = ${orderId} and type = 'order_auto_rejected'`)[0].total).toBe(1);

  await page.goto(`/pedidos/${orderId}`);
  await expect(visible(page, "order-status")).toHaveText("Recusado pela loja");
  await expect(page.locator('[data-testid="refund-note"]')).toHaveCount(0);

  // Uma terceira rodada não muda mais nada neste pedido.
  await runTasks(request);
  expect((await db`select count(*)::int as total from order_status_history where order_id = ${orderId} and status = 'rejected'`)[0].total).toBe(1);
});

test("Pix não pago (pedido pago pelo app): aviso faltando 3 minutos e expiração no prazo", async ({ request }) => {
  // Os pedidos novos são pagos direto à loja; o Pix com prazo só existe nos pagos pelo app (do seed).
  await setClock("2026-10-09T21:00");
  const [order] = await db`
    select o.id from orders o
    where o.status = 'awaiting_payment' and o.payment_method = 'pix' and o.payment_collection = 'app'
    order by o.created_at desc limit 1`;
  const orderId = order.id;
  await db`update orders set payment_expires_at = '2026-10-09T21:15:00-03:00' where id = ${orderId}`;
  await db`delete from notifications where order_id = ${orderId} and type = 'pix_expiring'`;

  await setClock("2026-10-09T21:13");
  const first = await runTasks(request);
  expect(first.avisos_pix_expirando).toBeGreaterThanOrEqual(1);
  expect((await db`select count(*)::int as total from notifications where order_id = ${orderId} and type = 'pix_expiring'`)[0].total).toBe(1);
  await runTasks(request);
  expect((await db`select count(*)::int as total from notifications where order_id = ${orderId} and type = 'pix_expiring'`)[0].total).toBe(1);

  await setClock("2026-10-09T21:16");
  await runTasks(request);
  expect((await db`select status from orders where id = ${orderId}`)[0].status).toBe("expired");
  expect((await db`select status from payments where order_id = ${orderId}`)[0].status).toBe("expired");
});

test("taxas: expediente esquecido aberto fecha sozinho no dia seguinte e vence depois do prazo", async ({ request }) => {
  const [store] = await db`select id from stores where slug = 'brasa-burger'`;
  await db`delete from fee_entries where store_id = ${store.id} and closing_id is null`;
  await db`
    insert into fee_entries (store_id, kind, amount_cents, business_date) values
      (${store.id}, 'order_fee', 50, '2026-11-20'), (${store.id}, 'order_fee', 50, '2026-11-20')`;

  // Ainda no mesmo expediente (antes das 5h do dia seguinte), nada fecha.
  await setClock("2026-11-21T04:30");
  await runTasks(request);
  expect((await db`select count(*)::int as total from store_closings where store_id = ${store.id}`)[0].total).toBe(0);

  await setClock("2026-11-21T09:00");
  const report = await runTasks(request);
  expect(report.expedientes_fechados).toBeGreaterThanOrEqual(1);
  const [closing] = await db`select business_date::text, status::text, total_due_cents, order_count, due_date::text from store_closings where store_id = ${store.id}`;
  expect(closing).toEqual({ business_date: "2026-11-20", status: "awaiting_payment", total_due_cents: 100, order_count: 2, due_date: "2026-11-24" });
  // Rodar de novo não cria outro fechamento.
  await runTasks(request);
  expect((await db`select count(*)::int as total from store_closings where store_id = ${store.id}`)[0].total).toBe(1);

  await setClock("2026-11-25T09:00");
  const later = await runTasks(request);
  expect(later.taxas_vencidas).toBeGreaterThanOrEqual(1);
  expect((await db`select status::text from store_closings where store_id = ${store.id}`)[0].status).toBe("overdue");
  // Vencido nunca bloqueia a loja sozinho.
  expect((await db`select status::text from stores where id = ${store.id}`)[0].status).toBe("active");
});

test("lembrete de avaliação uma hora depois da entrega, uma vez só", async ({ request }) => {
  const [order] = await db`
    select o.id from orders o where o.status = 'delivered' and not exists (select 1 from reviews r where r.order_id = o.id)
    order by o.created_at desc limit 1`;
  await db`update orders set completed_at = '2026-10-09T23:00:00-03:00' where id = ${order.id}`;
  // Rodadas anteriores neste arquivo podem já ter lembrado deste pedido.
  await db`delete from notifications where order_id = ${order.id} and type = 'review_reminder'`;
  const reminders = async () => (await db`select count(*)::int as total from notifications where order_id = ${order.id} and type = 'review_reminder'`)[0].total;

  await setClock("2026-10-09T23:30");
  await runTasks(request);
  expect(await reminders()).toBe(0);

  await setClock("2026-10-10T00:05");
  await runTasks(request);
  expect(await reminders()).toBe(1);
  await runTasks(request);
  expect(await reminders()).toBe(1);
});

test("indicação: quem indicou ganha o cupom quando o indicado recebe o primeiro pedido", async ({ request }) => {
  const [ana] = await db`select id from profiles where full_name = 'Ana Clara Souza'`;
  const [carla] = await db`select id from profiles where full_name = 'Carla Mendes'`;
  await db`insert into referrals (referrer_id, referred_id) values (${ana.id}, ${carla.id}) on conflict (referred_id) do nothing`;
  const rewards = async () => (await db`select count(*)::int as total from coupons where owner_profile_id = ${ana.id} and code like 'INDICOU-%'`)[0].total;
  const before = await rewards();

  const report = await runTasks(request);
  expect(report.cupons_de_indicacao).toBeGreaterThanOrEqual(1);
  expect(await rewards()).toBe(before + 1);
  const [referral] = await db`select rewarded_at is not null as rewarded, referrer_coupon_id is not null as has_coupon from referrals where referred_id = ${carla.id}`;
  expect(referral).toEqual({ rewarded: true, has_coupon: true });

  await runTasks(request);
  expect(await rewards()).toBe(before + 1);
});

test("faturas mensais antigas: nenhuma nova é gerada, e as abertas ainda vencem", async ({ request }) => {
  await setClock("2026-11-02T09:00");
  const november = async () => (await db`select count(*)::int as total from invoices where period_start = '2026-11-01'`)[0].total;
  const first = await runTasks(request);
  // A mensalidade foi trocada pela taxa por pedido.
  expect(first.faturas_geradas).toBe(0);
  expect(await november()).toBe(0);

  const [open] = await db`select count(*)::int as total from invoices where status = 'open' and due_date < '2026-11-12'`;
  await setClock("2026-11-12T09:00");
  const second = await runTasks(request);
  expect(second.faturas_vencidas).toBe(open.total);
  // Fatura vencida nunca suspende a loja sozinha: essa decisão é do admin.
  expect((await db`select count(*)::int as total from stores where status = 'suspended'`)[0].total).toBe(1);
});

test("banner e destaque vencidos saem do ar sozinhos", async ({ request }) => {
  await setClock("2026-11-12T09:00");
  const [banner] = await db`
    insert into banners (title, image_url, ends_at) values ('Banner vencido de teste', '/files/banners/sexta-da-pizza.webp', '2026-11-01T00:00:00-03:00') returning id`;
  await db`update stores set featured_until = '2026-11-01T00:00:00-03:00' where slug = 'brasa-burger'`;

  await runTasks(request);
  expect((await db`select active from banners where id = ${banner.id}`)[0].active).toBe(false);
  expect((await db`select featured_until from stores where slug = 'brasa-burger'`)[0].featured_until).toBeNull();
});

test("ferramentas do /dev: rodar tarefas e gerar pedido aleatório", async ({ page }) => {
  await setClock("2026-11-13T20:00");
  await page.goto("/dev");
  await page.getByRole("button", { name: "Rodar tarefas agendadas agora" }).click();
  await expect(visible(page, "dev-result")).toContainText("Tarefas rodadas.");

  const before = (await db`select count(*)::int as total from orders where status = 'paid'`)[0].total;
  await page.getByRole("button", { name: "Gerar pedido aleatório" }).click();
  await expect(visible(page, "dev-result")).toContainText("Pedido criado:");
  expect((await db`select count(*)::int as total from orders where status = 'paid'`)[0].total).toBe(before + 1);

  // Resetar exige a caixa de confirmação.
  await page.getByRole("button", { name: "Resetar banco" }).click();
  await expect(page.getByText("Marque a caixa para confirmar.")).toBeVisible();
});

test("a rota das tarefas só responde a POST", async ({ request }) => {
  expect((await request.get("/api/tarefas")).status()).toBe(405);
});
