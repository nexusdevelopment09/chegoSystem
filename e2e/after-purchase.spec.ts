import { expect, test } from "@playwright/test";
import { db, loginAs, placePaidOrder, setClock, visible, freshDatabase } from "./helpers";

// A Friday at 20h: the burger place is open.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

/** A delivered order of the customer at Brasa Burger, straight in the database. */
async function completeOrder(orderId: string, completedAt = new Date("2026-10-09T20:00:00-03:00")) {
  await db`
    update orders set status = 'delivered', accepted_at = ${completedAt}, ready_at = ${completedAt},
      dispatched_at = ${completedAt}, completed_at = ${completedAt}
    where id = ${orderId}`;
}

test("mensagens do pedido: conversa normal passa, telefone é bloqueado e registrado", async ({ page, browser }) => {
  const orderId = await placePaidOrder(page, "Ana Clara Souza", "brasa-burger", ["Batata com cheddar e bacon"]);

  const chat = () => page.locator('[data-testid="order-chat"]:visible');
  await chat().getByLabel("Escrever mensagem").fill("Pode mandar bastante molho? O total é R$ 27,99 mesmo?");
  await chat().getByRole("button", { name: "Enviar" }).click();
  await expect(chat()).toContainText("Pode mandar bastante molho?");

  const blockedCount = async () => (await db`select count(*)::int as total from blocked_message_attempts where order_id = ${orderId}`)[0].total;
  const attempts = ["Me chama no zap 82 99999-0000", "meu numero é 8 2 9 9 9 9 9 0 0 0 0", "segue @ana_clara", "olha em www.exemplo.com.br"];
  for (const [index, attempt] of attempts.entries()) {
    await chat().getByLabel("Escrever mensagem").fill(attempt);
    await chat().getByRole("button", { name: "Enviar" }).click();
    await expect(chat().getByText("Por segurança, não é permitido trocar contatos por aqui.")).toBeVisible();
    await expect.poll(blockedCount).toBe(index + 1);
    // What was typed stays in the box (so it can be fixed), but is never shown as a sent message.
    await expect(chat().getByLabel("Escrever mensagem")).toHaveValue(attempt);
    await expect(chat().locator("li").filter({ hasText: attempt })).toHaveCount(0);
  }
  expect((await db`select count(*)::int as total from order_messages where order_id = ${orderId}`)[0].total).toBe(1);
  const rules = await db`select matched_rule from blocked_message_attempts where order_id = ${orderId} order by created_at`;
  expect(rules.map((row) => row.matched_rule)).toEqual(["phone", "phone", "handle", "link"]);

  // The store answers; the customer sees it.
  const store = await (await browser.newContext()).newPage();
  await loginAs(store, "Thiago Bezerra");
  await store.goto(`/lojista/pedidos/${orderId}`);
  const storeChat = store.locator('[data-testid="order-chat"]:visible');
  await expect(storeChat).toContainText("Pode mandar bastante molho?");
  await storeChat.getByLabel("Escrever mensagem").fill("Pode deixar, vai caprichado!");
  await storeChat.getByRole("button", { name: "Enviar" }).click();
  await expect(storeChat).toContainText("Pode deixar, vai caprichado!");
  await store.context().close();

  await page.reload();
  await expect(chat()).toContainText("Pode deixar, vai caprichado!");

  // Someone else's order has no chat for this customer.
  await loginAs(page, "Bruno Henrique Lima");
  await page.goto(`/pedidos/${orderId}`);
  await expect(page.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();
});

test("mensagens encerram 2 horas depois da entrega", async ({ page }) => {
  const orderId = await placePaidOrder(page, "Ana Clara Souza", "brasa-burger", ["Batata com cheddar e bacon"]);
  await completeOrder(orderId);

  await setClock("2026-10-09T22:30");
  try {
    await page.goto(`/pedidos/${orderId}`);
    await expect(page.locator('[data-testid="order-chat"]:visible')).toContainText("As mensagens deste pedido estão encerradas.");
  } finally {
    await setClock("2026-10-09T20:00");
  }
});

test("avaliar depois da entrega: uma vez só, dentro de 7 dias, e a nota da loja muda", async ({ page }) => {
  const orderId = await placePaidOrder(page, "Ana Clara Souza", "brasa-burger", ["Batata com cheddar e bacon"]);

  // Before the delivery there is nothing to review.
  await expect(page.locator('[data-testid="review-box"]:visible')).toHaveCount(0);
  await completeOrder(orderId);
  const [before] = await db`select rating_count from stores where slug = 'brasa-burger'`;

  await page.reload();
  const box = page.locator('[data-testid="review-box"]:visible');
  await box.getByRole("button", { name: "Enviar avaliação" }).click();
  await expect(box.getByText("Escolha de 1 a 5 estrelas.")).toBeVisible();

  await box.getByRole("radio", { name: /^4 estrelas/ }).click();
  await box.getByLabel("Quer contar mais? (opcional)").fill("Chegou quentinho, só faltou guardanapo.");
  await box.getByRole("button", { name: "Enviar avaliação" }).click();
  await expect(box).toContainText("Chegou quentinho, só faltou guardanapo.");
  await expect(box.getByRole("button", { name: "Enviar avaliação" })).toHaveCount(0);

  const [after] = await db`select rating_count from stores where slug = 'brasa-burger'`;
  expect(after.rating_count).toBe(before.rating_count + 1);
  expect((await db`select rating from reviews where order_id = ${orderId}`)[0].rating).toBe(4);

  // After 7 days the form is gone for orders never reviewed.
  const [old] = await db`
    select o.id from orders o join profiles p on p.id = o.customer_id
    where p.full_name = 'Ana Clara Souza' and o.status = 'delivered' and o.completed_at < now() - interval '20 days'
      and not exists (select 1 from reviews r where r.order_id = o.id) limit 1`;
  await page.goto(`/pedidos/${old.id}`);
  await expect(visible(page, "order-status")).toHaveText("Entregue");
  await expect(page.locator('[data-testid="review-box"]:visible')).toHaveCount(0);
});

test("pedir de novo avisa o que esgotou e monta a sacola com o resto", async ({ page }) => {
  const orderId = await placePaidOrder(page, "Ana Clara Souza", "brasa-burger", ["Batata com cheddar e bacon", "Batata frita"]);
  await completeOrder(orderId);
  await db`update products set available = false where name = 'Batata frita'`;
  await db`update products set price_cents = 2600 where name = 'Batata com cheddar e bacon'`;

  try {
    await page.goto(`/pedidos/${orderId}`);
    await page.getByRole("button", { name: "Pedir de novo" }).click();
    const notes = visible(page, "reorder-notes");
    await expect(notes).toContainText("“Batata frita” esgotou e ficou de fora.");
    await expect(notes).toContainText("O preço de “Batata com cheddar e bacon” mudou.");

    await notes.getByRole("button", { name: "Ver a sacola" }).click();
    await expect(page).toHaveURL(/\/carrinho$/);
    await expect(page.locator('[data-testid="cart-item"]:visible')).toHaveCount(1);
    await expect(page.locator('[data-testid="summary-subtotal"]:visible')).toHaveText("R$ 26,00");
  } finally {
    await db`update products set available = true where name = 'Batata frita'`;
    await db`update products set price_cents = 2400 where name = 'Batata com cheddar e bacon'`;
  }
});

test("preciso de ajuda: abre chamado com motivo e conversa nele", async ({ page }) => {
  const orderId = await placePaidOrder(page, "Bruno Henrique Lima", "brasa-burger", ["Batata com cheddar e bacon"]);
  await page.getByRole("link", { name: "Preciso de ajuda" }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${orderId}/ajuda$`));

  await page.getByLabel("Motivo").selectOption("delay");
  await page.getByLabel("Conte o que aconteceu").fill("O pedido está demorando muito mais que o previsto.");
  await page.getByRole("button", { name: "Abrir chamado" }).click();

  const ticket = page.locator('[data-testid="ticket"]:visible');
  await expect(ticket).toContainText("Atraso");
  await expect(ticket.locator('[data-testid="ticket-status"]')).toHaveText("Aberto");
  await expect(ticket).toContainText("O pedido está demorando muito mais que o previsto.");
  // One open ticket per order: the form to open another is gone.
  await expect(page.getByRole("button", { name: "Abrir chamado" })).toHaveCount(0);

  await ticket.getByLabel("Responder").fill("Já faz uma hora.");
  await ticket.getByRole("button", { name: "Enviar" }).click();
  await expect(ticket).toContainText("Já faz uma hora.");

  const [row] = await db`select reason, status, (select count(*)::int from ticket_messages m where m.ticket_id = t.id) as messages from support_tickets t where order_id = ${orderId}`;
  expect(row).toEqual({ reason: "delay", status: "open", messages: 2 });
  const [notice] = await db`select count(*)::int as total from notifications where type = 'ticket_new' and order_id = ${orderId}`;
  expect(notice.total).toBe(1);
});

test("sino de notificações: contador, lista e marcar como lidas", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  const unread = (await db`
    select count(*)::int as total from notifications n join profiles p on p.id = n.profile_id
    where p.full_name = 'Ana Clara Souza' and n.read_at is null`)[0].total;
  expect(unread).toBeGreaterThan(0);

  await expect(visible(page, "bell")).toHaveAttribute("aria-label", new RegExp(`^Notificações: ${unread} não lida`));
  await visible(page, "bell").click();
  await expect(visible(page, "unread-count")).toHaveText(new RegExp(`^${unread} não lida`));

  await page.getByRole("button", { name: "Marcar todas como lidas" }).click();
  await expect(visible(page, "unread-count")).toHaveText("Você está em dia.");
  await expect(visible(page, "bell")).toHaveAttribute("aria-label", "Notificações");

  // Nobody else's notifications are ever listed.
  const mine = await db`
    select count(*)::int as total from notifications n join profiles p on p.id = n.profile_id where p.full_name = 'Ana Clara Souza'`;
  expect(await page.locator('[data-testid="notification"]:visible').count()).toBe(Math.min(60, mine[0].total));
});

test("perfil: editar dados, endereços, baixar meus dados e preferência de promoções", async ({ page }) => {
  await loginAs(page, "Carla Mendes");
  await page.goto("/perfil");
  await page.getByLabel("E-mail (opcional)").fill("carla@exemplo.test");
  await page.getByLabel("Data de nascimento (opcional)").fill("1990-04-02");
  await page.getByLabel("Quero receber promoções e novidades").uncheck();
  await page.getByRole("button", { name: "Salvar meus dados" }).click();
  await expect(page.getByText("Dados salvos.")).toBeVisible();
  expect((await db`select email, birth_date::text, promo_notifications from profiles where full_name = 'Carla Mendes'`)[0]).toEqual({
    email: "carla@exemplo.test", birth_date: "1990-04-02", promo_notifications: false,
  });

  // Rural address without a landmark is refused.
  await page.getByText("Adicionar endereço").click();
  await page.getByLabel("Rua").fill("Estrada Nova");
  await page.getByLabel("Bairro ou comunidade").selectOption({ label: "Sítio Mata Verde (zona rural)" });
  await page.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(page.getByText("Na zona rural, diga um ponto de referência para o entregador achar.")).toBeVisible();
  await page.getByLabel("Ponto de referência").fill("Depois da escola, casa amarela");
  await page.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(page.locator('[data-testid="profile-address"]:visible')).toHaveCount(2);
  await expect(page.locator('[data-testid="profile-address"]:visible').first()).toContainText("Estrada Nova");

  await page.getByRole("button", { name: "Remover o endereço Estrada Nova, S/N" }).click();
  await expect(page.locator('[data-testid="profile-address"]:visible')).toHaveCount(1);

  const exported = await page.request.get("/perfil/meus-dados");
  const data = await exported.json();
  expect(data.account).toMatchObject({ full_name: "Carla Mendes", email: "carla@exemplo.test" });
  expect(Array.isArray(data.orders)).toBe(true);
  expect(data.addresses).toHaveLength(1);
  // Nothing about other people leaks into the export.
  expect(JSON.stringify(data)).not.toContain("Ana Clara");
});

test("excluir conta: dados pessoais somem, pedidos ficam anônimos", async ({ page }) => {
  await loginAs(page, "João Pedro Barros");
  const [profile] = await db`select id from profiles where full_name = 'João Pedro Barros'`;
  const [{ orders }] = await db`select count(*)::int as orders from orders where customer_id = ${profile.id}`;
  expect(orders).toBeGreaterThan(0);

  await page.goto("/perfil");
  await page.getByText("Excluir minha conta", { exact: true }).click();
  await page.getByLabel("Para confirmar, escreva EXCLUIR").fill("sim");
  await page.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
  await expect(page.getByText("Para confirmar, escreva EXCLUIR.")).toBeVisible();

  await page.getByLabel("Para confirmar, escreva EXCLUIR").fill("EXCLUIR");
  await page.getByRole("button", { name: "Excluir minha conta para sempre" }).click();
  await expect(page).toHaveURL(/\/entrar$/);

  const [after] = await db`select full_name, phone, email, deleted_at is not null as deleted from profiles where id = ${profile.id}`;
  expect(after).toEqual({ full_name: "Cliente removido", phone: null, email: null, deleted: true });
  const kept = await db`select distinct customer_name, customer_phone, address_snapshot from orders where customer_id = ${profile.id}`;
  expect(kept).toEqual([{ customer_name: "Cliente removido", customer_phone: null, address_snapshot: null }]);
  expect((await db`select count(*)::int as total from orders where customer_id = ${profile.id}`)[0].total).toBe(orders);
  expect((await db`select count(*)::int as total from addresses where profile_id = ${profile.id}`)[0].total).toBe(0);

  // The old session is dead.
  await page.goto("/perfil");
  await expect(page).toHaveURL(/\/entrar$/);
});
