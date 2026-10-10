import { expect, test } from "@playwright/test";
import { chooseNeighborhood, db, loginAs, placePaidOrder, setClock, visible, freshDatabase } from "./helpers";

// A Friday at 20h: the pizzaria and the burger place are open.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

const column = (page: import("@playwright/test").Page, title: string) => page.locator(`[data-testid="column-${title}"]:visible`);

test("loja recebe o alerta, aceita, prepara e despacha; entregador conclui com o código", async ({ page }) => {
  const orderId = await placePaidOrder(page, "Ana Clara Souza", "pizzaria-forno-de-barro", ["Refrigerante 2 L", "Suco natural 500 ml", "Refrigerante lata"]);
  const [order] = await db`select code, delivery_code from orders where id = ${orderId}`;

  await loginAs(page, "Juliana Peixoto");
  await expect(page).toHaveURL(/\/lojista\/pedidos$/);
  const alert = visible(page, "new-order-alert");
  await expect(alert).toContainText("esperando");
  expect(Number(await alert.getAttribute("data-waiting"))).toBeGreaterThanOrEqual(1);

  const card = () => page.locator('[data-testid="merchant-order"]:visible').filter({ hasText: order.code });
  await expect(column(page, "Novos").getByText(order.code)).toBeVisible();
  // The store sees who to deliver to only now, after the payment.
  await expect(card()).toContainText("Ana Clara Souza");

  await card().getByLabel("Preparo (min)").fill("40");
  await card().getByRole("button", { name: "Aceitar" }).click();
  await expect(column(page, "Em preparo").getByText(order.code)).toBeVisible();

  await card().getByRole("button", { name: "Começar o preparo" }).click();
  await card().getByRole("button", { name: "Marcar como pronto" }).click();
  await expect(column(page, "Prontos").getByText(order.code)).toBeVisible();

  await card().getByLabel("Entregador").selectOption({ label: "Robson Entregas" });
  await card().getByRole("button", { name: "Saiu para entrega" }).click();
  await expect(column(page, "Em entrega").getByText(order.code)).toBeVisible();

  // The courier only has his own deliveries, and needs the customer's code.
  await loginAs(page, "Robson Entregas");
  await expect(page).toHaveURL(/\/lojista\/entregas$/);
  const delivery = page.locator('[data-testid="delivery"]:visible').filter({ hasText: order.code });
  await expect(delivery).toContainText("Rua do Comércio, 120");
  await expect(delivery.getByRole("link", { name: "Abrir no mapa" })).toHaveAttribute("href", /google\.com\/maps/);

  const wrong = order.delivery_code === "0000" ? "1111" : "0000";
  await delivery.getByLabel("Código de entrega (peça ao cliente)").fill(wrong);
  await delivery.getByRole("button", { name: "Entreguei" }).click();
  await expect(delivery.getByText("Código errado.")).toBeVisible();

  await delivery.getByLabel("Código de entrega (peça ao cliente)").fill(order.delivery_code);
  await delivery.getByRole("button", { name: "Entreguei" }).click();
  await expect(delivery).toHaveCount(0);

  const history = await db`select status from order_status_history where order_id = ${orderId} order by created_at`;
  expect(history.map((row) => row.status)).toEqual([
    "awaiting_payment", "paid", "accepted", "preparing", "ready", "out_for_delivery", "delivered",
  ]);
  const [done] = await db`select status, courier_id is not null as has_courier, estimated_at from orders where id = ${orderId}`;
  expect(done).toMatchObject({ status: "delivered", has_courier: true });

  await loginAs(page, "Ana Clara Souza");
  await page.goto(`/pedidos/${orderId}`);
  await expect(visible(page, "order-status")).toHaveText("Entregue");
});

test("loja recusa com motivo: cliente recebe o dinheiro e o aviso", async ({ page }) => {
  const orderId = await placePaidOrder(page, "Bruno Henrique Lima", "brasa-burger", ["Batata com cheddar e bacon"]);
  const [order] = await db`select code, total_cents from orders where id = ${orderId}`;

  await loginAs(page, "Thiago Bezerra");
  const card = page.locator('[data-testid="merchant-order"]:visible').filter({ hasText: order.code });
  await card.getByText("Recusar pedido").click();
  await card.getByRole("button", { name: "Confirmar recusa e reembolsar" }).click();
  // The reason is mandatory.
  await card.getByLabel("Motivo").selectOption("Item esgotado");
  await card.getByRole("button", { name: "Confirmar recusa e reembolsar" }).click();
  await expect(card).toHaveCount(0);

  const [after] = await db`select status, refunded_cents from orders where id = ${orderId}`;
  expect(after).toEqual({ status: "rejected", refunded_cents: order.total_cents });
  const [history] = await db`select reason from order_status_history where order_id = ${orderId} and status = 'rejected'`;
  expect(history.reason).toBe("Item esgotado");
  const notices = await db`select title from notifications where order_id = ${orderId} and type = 'order_rejected'`;
  expect(notices).toEqual([{ title: "Eita, a loja não pôde aceitar seu pedido" }]);
  const sms = await db`select body from outbound_messages where channel = 'sms' and body like '%não pôde aceitar%' order by created_at desc limit 1`;
  expect(sms).toHaveLength(1);

  await loginAs(page, "Bruno Henrique Lima");
  await page.goto(`/pedidos/${orderId}`);
  await expect(visible(page, "order-status")).toHaveText("Recusado pela loja");
  await expect(visible(page, "refund-note")).toBeVisible();
});

test("mercado remove item em falta: reembolso parcial com os lançamentos certos", async ({ page }) => {
  await setClock("2026-10-09T15:00");
  try {
    const orderId = await placePaidOrder(
      page, "Ana Clara Souza", "mercado-boa-compra",
      ["Arroz branco 1 kg", "Feijão carioca 1 kg", "Café torrado 250 g", "Leite em pó 400 g"],
      () => page.getByRole("radio", { name: "Remover o item e devolver o valor" }).check(),
    );
    const [order] = await db`select code, total_cents, store_amount_cents from orders where id = ${orderId}`;

    await loginAs(page, "Cícero Vieira");
    await page.locator('[data-testid="merchant-order"]:visible').filter({ hasText: order.code }).getByRole("button", { name: "Aceitar" }).click();
    await page.goto(`/lojista/pedidos/${orderId}`);
    await expect(page.getByText("Se faltar um item: Remover o item e devolver o valor")).toBeVisible();

    const item = page.locator('[data-testid="merchant-item"]:visible').filter({ hasText: "Leite em pó 400 g" });
    await item.getByRole("button").click();
    await expect(item).toContainText("Removido: Item em falta");
    await expect(visible(page, "merchant-refunded")).toHaveText("Reembolsado ao cliente: R$ 16,90");

    // The order keeps going; only the money of that item went back.
    const [after] = await db`select status, refunded_cents from orders where id = ${orderId}`;
    expect(after).toEqual({ status: "accepted", refunded_cents: 1690 });
    const [refund] = await db`select amount_cents, store_share_cents, platform_share_cents from refunds where order_id = ${orderId}`;
    expect(refund.store_share_cents + refund.platform_share_cents).toBe(1690);
    expect(refund.store_share_cents).toBe(Math.round((1690 * order.store_amount_cents) / order.total_cents));
    const ledger = await db`select account, direction, amount_cents from ledger_entries where order_id = ${orderId} and reason = 'refund' order by account`;
    expect(ledger).toEqual([
      { account: "store", direction: "debit", amount_cents: refund.store_share_cents },
      { account: "platform", direction: "debit", amount_cents: refund.platform_share_cents },
    ]);
    expect((await db`select status from payments where order_id = ${orderId}`)[0].status).toBe("partially_refunded");

    await loginAs(page, "Ana Clara Souza");
    await page.goto(`/pedidos/${orderId}`);
    await expect(visible(page, "refund-note")).toHaveText("Devolvemos R$ 16,90 para você.");
  } finally {
    await setClock("2026-10-09T20:00");
  }
});

test("cada um só vê o que é da sua loja e do seu papel", async ({ page }) => {
  const [pizzaOrder] = await db`
    select o.id from orders o join stores s on s.id = o.store_id
    where s.slug = 'pizzaria-forno-de-barro' and o.status = 'out_for_delivery' limit 1`;

  // An attendant of another store cannot open the pizzaria's order.
  await loginAs(page, "Cícero Vieira");
  await page.goto(`/lojista/pedidos/${pizzaOrder.id}`);
  await expect(page.getByRole("heading", { name: "Oxe, essa página não existe." })).toBeVisible();

  // A courier has no counter: the orders page sends him to his deliveries.
  await loginAs(page, "Robson Entregas");
  await page.goto("/lojista/pedidos");
  await expect(page).toHaveURL(/\/lojista\/entregas$/);
  await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);

  // An attendant sees orders and menu, not the money.
  await loginAs(page, "Juliana Peixoto");
  await expect(page.getByRole("link", { name: "Cardápio" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Financeiro" })).toHaveCount(0);
});

test("dono marca entregue sem código, mas precisa dizer o motivo", async ({ page }) => {
  const [order] = await db`
    select o.id, o.code from orders o join stores s on s.id = o.store_id
    where s.slug = 'pizzaria-forno-de-barro' and o.status = 'out_for_delivery' order by o.created_at limit 1`;

  await loginAs(page, "Marcos Antônio Tavares");
  await page.goto("/lojista/entregas");
  const delivery = page.locator('[data-testid="delivery"]:visible').filter({ hasText: order.code });
  await delivery.getByRole("button", { name: "Entreguei" }).click();
  await expect(delivery.getByText("Sem o código, diga por que o pedido está sendo marcado como entregue.")).toBeVisible();

  await delivery.getByLabel("Sem código? Diga o motivo").fill("Cliente perdeu o celular");
  await delivery.getByRole("button", { name: "Entreguei" }).click();
  await expect(delivery).toHaveCount(0);

  const log = await db`select details from audit_logs where action = 'order.delivered_without_code' and entity_id = ${order.id}`;
  expect(log).toEqual([{ details: { reason: "Cliente perdeu o celular" } }]);
});

test("abrir, fechar, pausar e movimento alto aparecem para o cliente", async ({ page, browser }) => {
  const customer = await (await browser.newContext()).newPage();
  await chooseNeighborhood(customer, "Centro");
  const storeState = async () => {
    await customer.goto("/loja/brasa-burger");
    return customer.locator('[data-testid="store-state"]:visible');
  };

  await loginAs(page, "Thiago Bezerra");
  await expect(visible(page, "merchant-store-state")).toHaveText("aberta");

  await page.getByRole("button", { name: "Fechar agora" }).click();
  await expect(visible(page, "merchant-store-state")).toHaveText("fechada");
  await expect(await storeState()).toHaveText("Abre amanhã às 18h");

  await page.getByRole("button", { name: "Seguir os horários" }).click();
  await expect(visible(page, "merchant-store-state")).toHaveText("aberta");

  await page.getByRole("button", { name: "30 min", exact: true }).click();
  await expect(visible(page, "merchant-store-state")).toHaveText("pausada");
  await expect(await storeState()).toHaveText("Voltamos às 20h30");
  await page.getByRole("button", { name: "Voltar agora" }).click();

  await page.getByRole("button", { name: "+30 min" }).click();
  await expect(page.getByText("movimento alto (+30 min)")).toBeVisible();
  await storeState();
  await expect(customer.getByText("Movimento alto: os pedidos estão levando cerca de 30 minutos a mais.")).toBeVisible();
  await page.getByRole("button", { name: "Normal" }).click();
  await customer.context().close();
});

test("impressão térmica mostra os sabores, a borda e o aviso de documento", async ({ page }) => {
  const [order] = await db`
    select o.id from orders o join stores s on s.id = o.store_id
    join order_items i on i.order_id = o.id join order_item_options op on op.order_item_id = i.id
    where s.slug = 'pizzaria-forno-de-barro' and o.paid_at is not null and op.group_name = 'Sabores'
    group by o.id having count(*) >= 2 limit 1`;

  await loginAs(page, "Marcos Antônio Tavares");
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(`/lojista/pedidos/${order.id}/imprimir?l=58`);
  const ticket = visible(page, "ticket");
  await expect(ticket).toContainText("Pizzaria Forno de Barro");
  await expect(ticket).toContainText(/1\/[23] /);
  await expect(ticket).toContainText("TOTAL");
  expect(await ticket.evaluate((element) => (element as HTMLElement).style.width)).toBe("58mm");

  await page.goto(`/lojista/pedidos/${order.id}/imprimir`);
  expect(await visible(page, "ticket").evaluate((element) => (element as HTMLElement).style.width)).toBe("80mm");
});
