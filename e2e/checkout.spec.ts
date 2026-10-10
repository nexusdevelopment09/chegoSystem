import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chooseNeighborhood, db, loginAs, loginWithPhone, productUrl, setClock, freshDatabase } from "./helpers";

// Uma sexta às 20h: os lugares de jantar, o depósito e a farmácia estão abertos.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));
// Cada teste começa sem uma sacola salva no servidor por um teste anterior.
test.beforeEach(() => db`delete from carts`);

test.use({ testIdAttribute: "data-testid" });

const addButton = (page: Page) => page.getByRole("button", { name: /^Adicionar/ });

/** Adiciona um produto que não precisa de escolhas e cai na página da loja. */
async function addSimple(page: Page, storeSlug: string, product: string) {
  await page.goto(await productUrl(storeSlug, product));
  await addButton(page).click();
  await page.waitForURL(new RegExp(`/loja/${storeSlug}$`));
}

async function placeOrder(page: Page) {
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]+\/pagamento$/);
  return page.url().match(/pedidos\/([0-9a-f-]+)\//)![1];
}

test("cliente novo monta pizza de 2 sabores, usa PRIMEIRA, paga com Pix e acompanha", async ({ page }) => {
  await loginWithPhone(page, "(82) 97777-0001");
  await page.getByLabel("Seu nome completo").fill("Cliente Novo de Teste");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar minha conta" }).click();
  await chooseNeighborhood(page, "Centro");

  await page.goto(await productUrl("pizzaria-forno-de-barro", "Pizza Grande (8 fatias)"));
  await page.getByRole("checkbox", { name: "Calabresa", exact: true }).click();
  await page.getByRole("checkbox", { name: "Carne de Sol com Queijo Coalho" }).click();
  await page.getByRole("radio", { name: "Catupiry" }).click();
  await addButton(page).click();
  await page.locator('[data-testid="cart-bar"]:visible').click();

  await expect(page.locator('[data-testid="cart-item"]:visible')).toContainText("1/2 Calabresa");
  await expect(page.locator('[data-testid="cart-item"]:visible')).toContainText("Borda: Catupiry");
  await page.getByLabel("Cupom de desconto").fill("primeira");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.locator('[data-testid="coupon-message"]:visible')).toHaveText("Cupom aplicado");
  await expect(page.locator('[data-testid="summary-discount"]:visible')).toHaveText("− R$ 10,00");
  await page.getByRole("link", { name: "Continuar" }).click();

  // Ainda sem endereço: o formulário já vem aberto.
  await page.getByLabel("Rua").fill("Rua das Acácias");
  await page.getByLabel("Número").fill("77");
  await page.getByLabel("Bairro ou comunidade").selectOption({ label: "Centro" });
  await page.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(page.getByText("Rua das Acácias, 77")).toBeVisible();
  // 64,00 - 10,00 + 3,00 de entrega + 0,99 de taxa de serviço.
  await expect(page.locator('[data-testid="summary-total"]:visible')).toHaveText("R$ 57,99");

  const orderId = await placeOrder(page);
  await expect(page.locator('[data-testid="pix-qr"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid="pix-code"]:visible')).toHaveValue(/^000201/);
  await expect(page.locator('[data-testid="pix-countdown"]:visible')).toHaveText(/^1[45]:\d\d$/);

  // A loja não pode ver o pedido antes de o pagamento ser confirmado.
  const [before] = await db`select status, paid_at from orders where id = ${orderId}`;
  expect(before).toMatchObject({ status: "awaiting_payment", paid_at: null });

  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${orderId}$`));
  await expect(page.locator('[data-testid="order-status"]:visible')).toHaveText("Pago, esperando a loja aceitar");
  await expect(page.locator('[data-testid="delivery-code"]:visible')).toHaveText(/^\d{4}$/);

  const [order] = await db`select * from orders where id = ${orderId}`;
  expect(order).toMatchObject({
    code: expect.stringMatching(/^JG-\d{4}$/), status: "paid", subtotal_cents: 6400, discount_cents: 1000,
    discount_paid_by: "platform", delivery_fee_cents: 300, service_fee_cents: 99, total_cents: 5799,
    commission_rate: "0.1200", commission_cents: 768, platform_amount_cents: -133, store_amount_cents: 5932,
  });
  const ledger = await db`select account, direction, amount_cents from ledger_entries where order_id = ${orderId} order by account`;
  expect(ledger).toEqual([
    { account: "store", direction: "credit", amount_cents: 5932 },
    { account: "platform", direction: "debit", amount_cents: 133 },
  ]);
  const options = await db`
    select o.option_name, o.price_cents from order_item_options o join order_items i on i.id = o.order_item_id
    where i.order_id = ${orderId} order by o.sort_order`;
  expect(options).toEqual([
    { option_name: "Calabresa", price_cents: 4500 },
    { option_name: "Carne de Sol com Queijo Coalho", price_cents: 5600 },
    { option_name: "Catupiry", price_cents: 800 },
  ]);
});

test("preço adulterado no navegador é ignorado: vale o do banco", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");

  await page.evaluate(() => {
    const cart = JSON.parse(window.localStorage.getItem("chego_cart")!);
    cart.items[0].unitPriceCents = 1;
    window.localStorage.setItem("chego_cart", JSON.stringify(cart));
  });
  await page.goto("/carrinho");
  await expect(page.getByText("O preço de “Batata com cheddar e bacon” mudou para R$ 24,00.")).toBeVisible();
  await expect(page.locator('[data-testid="summary-subtotal"]:visible')).toHaveText("R$ 24,00");

  await page.getByRole("link", { name: "Continuar" }).click();
  const orderId = await placeOrder(page);
  const [order] = await db`select subtotal_cents, total_cents from orders where id = ${orderId}`;
  expect(order).toEqual({ subtotal_cents: 2400, total_cents: 2799 });
});

test("webhook: assinatura errada é recusada e evento repetido não duplica nada", async ({ page, request }) => {
  await loginAs(page, "Bruno Henrique Lima");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");
  await page.goto("/checkout");
  const orderId = await placeOrder(page);
  const [payment] = await db`select provider_payment_id from payments where order_id = ${orderId}`;

  const body = JSON.stringify({ id: randomUUID(), type: "payment.approved", data: { payment_id: payment.provider_payment_id } });
  const signature = createHmac("sha256", "segredo-local-de-teste").update(body).digest("hex");
  const send = (headers: Record<string, string>) =>
    request.post("/api/webhooks/pagamentos", { data: body, headers: { "content-type": "application/json", ...headers } });

  expect((await send({})).status()).toBe(401);
  expect((await send({ "x-signature": "00".repeat(32) })).status()).toBe(401);
  expect((await db`select status from orders where id = ${orderId}`)[0].status).toBe("awaiting_payment");

  const first = await send({ "x-signature": signature });
  expect(await first.json()).toEqual({ received: true, outcome: "processed" });
  const second = await send({ "x-signature": signature });
  expect(await second.json()).toEqual({ received: true, outcome: "duplicate" });

  expect((await db`select status from orders where id = ${orderId}`)[0].status).toBe("paid");
  expect(await db`select count(*)::int as total from ledger_entries where order_id = ${orderId}`).toEqual([{ total: 2 }]);
  expect(await db`select count(*)::int as total from order_status_history where order_id = ${orderId} and status = 'paid'`).toEqual([{ total: 1 }]);
  expect(await db`select count(*)::int as total from notifications where order_id = ${orderId} and type = 'order_new'`).toEqual([{ total: 1 }]);
});

test("cartão recusado (final 1111) e depois aprovado com outro cartão (final 0000)", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "brasa-burger", "Batata frita");
  await addSimple(page, "brasa-burger", "Anéis de cebola");
  await page.goto("/checkout");

  await page.getByRole("radio", { name: "Cartão de crédito" }).check();
  await page.getByLabel("Número do cartão").fill("4111 1111 1111 1111");
  await page.getByLabel("Nome no cartão").fill("ANA C SOUZA");
  await page.getByLabel("Validade (MM/AA)").fill("12/30");
  await page.getByLabel("Código de segurança").fill("123");
  const orderId = await placeOrder(page);
  await expect(page.locator('[data-testid="payment-declined"]:visible')).toBeVisible();

  await page.getByText("Pagar com cartão de crédito").click();
  await page.getByLabel("Número do cartão").fill("4000 0000 0000 0000");
  await page.getByLabel("Nome no cartão").fill("ANA C SOUZA");
  await page.getByLabel("Validade (MM/AA)").fill("12/30");
  await page.getByLabel("Código de segurança").fill("123");
  await page.getByRole("button", { name: "Pagar com cartão", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/pedidos/${orderId}$`));
  await expect(page.locator('[data-testid="order-status"]:visible')).toHaveText("Pago, esperando a loja aceitar");
  const payments = await db`select method, status from payments where order_id = ${orderId} order by created_at`;
  expect(payments).toEqual([{ method: "card", status: "declined" }, { method: "card", status: "approved" }]);
});

test("Pix expirado cancela o pedido e devolve o estoque", async ({ page }) => {
  const stock = async () => (await db`select stock_qty from products where name = 'Termômetro digital'`)[0].stock_qty;
  const before = await stock();

  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "farmacia-saude-mais", "Termômetro digital");
  await page.goto("/checkout");
  const orderId = await placeOrder(page);
  expect(await stock()).toBe(before - 1);

  await page.getByRole("button", { name: "Simular expiração" }).click();
  await expect(page.locator('[data-testid="order-status"]:visible')).toHaveText("Pagamento expirado");
  expect(await stock()).toBe(before);
  expect((await db`select status from payments where order_id = ${orderId}`)[0].status).toBe("expired");
});

test("cliente cancela pedido pago antes do aceite e recebe tudo de volta", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");
  await page.goto("/checkout");
  const orderId = await placeOrder(page);
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();

  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.locator('[data-testid="order-status"]:visible')).toHaveText("Cancelado");
  await expect(page.locator('[data-testid="refund-note"]:visible')).toHaveText("Devolvemos R$ 27,99 para você.");

  const [order] = await db`select refunded_cents, total_cents from orders where id = ${orderId}`;
  expect(order.refunded_cents).toBe(order.total_cents);
  const [balance] = await db`
    select sum(case when direction = 'credit' then amount_cents else -amount_cents end)::int as net
    from ledger_entries where order_id = ${orderId}`;
  expect(balance.net).toBe(0);
});

test("pedido mínimo: avisa quanto falta e não deixa continuar", async ({ page }) => {
  await chooseNeighborhood(page, "Centro");
  await addSimple(page, "farmacia-saude-mais", "Sais de reidratação — envelope");
  await page.goto("/carrinho");
  await expect(page.locator('[data-testid="min-order"]:visible')).toHaveText("Faltam R$ 7,50 para o pedido mínimo de R$ 10,00.");
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();

  await page.getByRole("button", { name: /^Aumentar/ }).click();
  await page.getByRole("button", { name: /^Aumentar/ }).click();
  await page.getByRole("button", { name: /^Aumentar/ }).click();
  await expect(page.locator('[data-testid="min-order"]:visible')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continuar" })).toBeVisible();
});

test("cupons recusados dizem o motivo", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");
  await addSimple(page, "brasa-burger", "Batata frita");
  await page.goto("/carrinho");

  const expectations: [string, string][] = [
    ["VELHO", "Cupom expirado"],
    ["ESGOTOU", "Este cupom já esgotou"],
    ["PRIMEIRA", "Este cupom é só para a primeira compra"],
    ["PIZZA10", "Este cupom não vale para esta loja"],
    ["FRETEGRATIS", "Pedido mínimo de R$ 50,00 para este cupom"],
    ["NAOEXISTE", "Cupom não encontrado"],
  ];
  for (const [code, message] of expectations) {
    await page.getByLabel("Cupom de desconto").fill(code);
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.locator('[data-testid="coupon-message"]:visible')).toHaveText(message);
  }
});

test("indicação: o código de um amigo vale desconto na primeira compra", async ({ page }) => {
  await loginAs(page, "Diego Alves");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");
  await page.goto("/carrinho");
  const [ana] = await db`select referral_code from profiles where full_name = 'Ana Clara Souza'`;
  await page.getByLabel("Cupom de desconto").fill(ana.referral_code);
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.locator('[data-testid="summary-discount"]:visible')).toHaveText("− R$ 5,00");

  await page.getByRole("link", { name: "Continuar" }).click();
  await placeOrder(page);
  const [referral] = await db`
    select r.rewarded_at from referrals r join profiles p on p.id = r.referred_id where p.full_name = 'Diego Alves'`;
  expect(referral).toEqual({ rewarded_at: null });
});

test("menor de idade não consegue comprar bebida alcoólica; adulto precisa confirmar", async ({ page }) => {
  await loginAs(page, "Isabela Ferreira");
  for (let index = 0; index < 4; index += 1) {
    await page.goto(await productUrl("deposito-gelada-ja", "Cerveja long neck 330 ml"));
    await page.getByRole("radio", { name: "Gelada" }).click();
    await addButton(page).click();
    await page.waitForURL(/\/loja\/deposito-gelada-ja$/);
  }
  await page.goto("/checkout");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await expect(page.locator('[data-testid="checkout-errors"]:visible')).toContainText("Bebidas alcoólicas só podem ser vendidas para maiores de 18 anos.");

  // Um adulto precisa marcar a confirmação.
  await loginAs(page, "Ana Clara Souza");
  await page.goto("/checkout");
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await expect(page.locator('[data-testid="checkout-errors"]:visible')).toContainText("Confirme que você tem 18 anos ou mais.");
  await page.getByRole("checkbox").check();
  const orderId = await placeOrder(page);
  expect((await db`select requires_age_check, age_confirmed from orders where id = ${orderId}`)[0]).toEqual({
    requires_age_check: true, age_confirmed: true,
  });
});

test("cliente bloqueado não consegue finalizar pedido", async ({ page }) => {
  await loginAs(page, "Henrique Costa");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");
  await page.goto("/checkout");
  await expect(page.getByText("Sua conta está bloqueada para novos pedidos. Fale com o suporte.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fazer pedido/ })).toBeDisabled();
});

test("zona rural: paga a taxa da comunidade; loja que não atende avisa", async ({ page }) => {
  await loginAs(page, "Carla Mendes");
  for (const item of ["Carvão 3 kg", "Gelo 5 kg"]) await addSimple(page, "deposito-gelada-ja", item);
  await page.goto("/checkout");
  await expect(page.getByText("Referência: Casa azul depois da ponte, portão de madeira")).toBeVisible();
  await expect(page.locator('[data-testid="summary-delivery"]:visible')).toHaveText("R$ 8,00");
  const orderId = await placeOrder(page);
  const [order] = await db`select delivery_fee_cents, address_snapshot from orders where id = ${orderId}`;
  expect(order.delivery_fee_cents).toBe(800);
  expect(order.address_snapshot).toMatchObject({ neighborhood: "Sítio Riacho Fundo", rural: true });

  await page.goto(await productUrl("brasa-burger", "Batata com cheddar e bacon"));
  await addButton(page).click();
  await page.waitForURL(/\/loja\/brasa-burger$/);
  await page.goto("/checkout");
  await expect(page.locator('[data-testid="delivery-problem"]:visible')).toHaveText("Essa loja ainda não entrega em Sítio Riacho Fundo.");
  await page.getByRole("radio", { name: "Retirar no balcão" }).check();
  await expect(page.locator('[data-testid="summary-delivery"]:visible')).toHaveText("Grátis");
});

test("mercado pergunta o que fazer se faltar um item", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  for (const item of ["Arroz branco 1 kg", "Feijão carioca 1 kg", "Café torrado 250 g", "Leite em pó 400 g"]) {
    await addSimple(page, "mercado-boa-compra", item);
  }
  await setClock("2026-10-09T15:00");
  try {
    await page.goto("/checkout");
    await page.getByRole("button", { name: /^Fazer pedido/ }).click();
    await expect(page.locator('[data-testid="checkout-errors"]:visible')).toContainText("Diga o que fazer se faltar um item.");

    await page.getByRole("radio", { name: "Remover o item e devolver o valor" }).check();
    const orderId = await placeOrder(page);
    expect((await db`select missing_item_policy from orders where id = ${orderId}`)[0].missing_item_policy).toBe("remove");
  } finally {
    await setClock("2026-10-09T20:00");
  }
});

test("quentinha depois das 11h só permite agendar para amanhã", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await setClock("2026-10-09T11:30");
  try {
    await page.goto(await productUrl("quentinha-da-dona-lia", "Marmita Fitness"));
    await addButton(page).click();
    await page.waitForURL(/\/loja\/quentinha-da-dona-lia$/);
    await page.goto("/checkout");

    await expect(page.locator('[data-testid="now-blocked"]:visible')).toHaveText("Os pedidos de hoje já fecharam. Quer agendar para amanhã?");
    await expect(page.getByRole("radio", { name: /^Agora/ })).toHaveCount(0);

    const slot = page.getByLabel("Dia e hora do agendamento");
    await expect(slot.locator("option").nth(1)).toHaveText("Amanhã às 11h30");
    await slot.selectOption({ label: "Amanhã às 12h" });
    const orderId = await placeOrder(page);
    const [order] = await db`select scheduled_for from orders where id = ${orderId}`;
    expect(order.scheduled_for.toISOString()).toBe("2026-10-10T15:00:00.000Z");
  } finally {
    await setClock("2026-10-09T20:00");
  }
});

test("a sacola acompanha o cliente em outro aparelho", async ({ page, browser }) => {
  await loginAs(page, "Gabriela Nunes");
  await addSimple(page, "brasa-burger", "Batata com cheddar e bacon");
  await page.goto("/carrinho");
  await expect(page.locator('[data-testid="cart-item"]:visible')).toHaveCount(1);
  // Dá um instante para o salvamento em segundo plano.
  await expect.poll(async () => (await db`
    select count(*)::int as total from cart_items i join carts c on c.id = i.cart_id
    join profiles p on p.id = c.profile_id where p.full_name = 'Gabriela Nunes'`)[0].total).toBe(1);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await loginAs(otherPage, "Gabriela Nunes");
  await otherPage.goto("/carrinho");
  await expect(otherPage.getByTestId("cart-item")).toContainText("Batata com cheddar e bacon");
  await other.close();
});
