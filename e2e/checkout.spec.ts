import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chooseNeighborhood, createAccount, db, loginAs, productUrl, setClock, freshDatabase } from "./helpers";

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

/** Fecha o pedido. Pagando direto à loja, o cliente cai direto no acompanhamento. */
async function placeOrder(page: Page) {
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]+$/);
  return page.url().match(/pedidos\/([0-9a-f-]+)$/)![1];
}

test("cliente novo monta pizza de 2 sabores, usa PRIMEIRA e paga com Pix direto à loja", async ({ page, browser }) => {
  await createAccount(page, "Cliente Novo de Teste", "(82) 97777-0001");
  await expect(page).toHaveURL(/\/$/);
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
  // Só os bairros que a loja atende, com a taxa de cada um.
  await page.getByLabel("Bairro ou comunidade").selectOption({ label: "Centro · entrega R$ 3,00" });
  await page.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(page.getByText("Rua das Acácias, 77")).toBeVisible();
  // 64,00 - 10,00 + 3,00 de entrega. Pagando direto à loja não há taxa de serviço.
  await expect(page.locator('[data-testid="summary-total"]:visible')).toHaveText("R$ 57,00");
  await expect(page.getByRole("radio", { name: "Pix para a loja" })).toBeChecked();

  // O pedido vai direto para a loja: não há tela de pagamento no app.
  const orderId = await placeOrder(page);
  await expect(page.locator('[data-testid="order-status"]:visible')).toHaveText("Enviado, esperando a loja aceitar");
  await expect(page.locator('[data-testid="payment-line"]:visible')).toContainText("Pix para a loja");
  await expect(page.locator('[data-testid="delivery-code"]:visible')).toHaveText(/^\d{4}$/);
  // A chave Pix da loja só aparece depois que ela aceita.
  await expect(page.locator('[data-testid="store-pix-key"]')).toHaveCount(0);

  const [order] = await db`select * from orders where id = ${orderId}`;
  expect(order).toMatchObject({
    code: expect.stringMatching(/^JG-\d{4}$/), status: "paid", payment_collection: "store", payment_method: "pix",
    subtotal_cents: 6400, discount_cents: 1000, discount_paid_by: "platform", delivery_fee_cents: 300, service_fee_cents: 0,
    total_cents: 5700, commission_cents: 0, platform_amount_cents: -1000, store_amount_cents: 6700,
  });
  // Nenhum dinheiro passou pelo app.
  expect(await db`select count(*)::int as total from payments where order_id = ${orderId}`).toEqual([{ total: 0 }]);
  expect(await db`select count(*)::int as total from ledger_entries where order_id = ${orderId}`).toEqual([{ total: 0 }]);
  const options = await db`
    select o.option_name, o.price_cents from order_item_options o join order_items i on i.id = o.order_item_id
    where i.order_id = ${orderId} order by o.sort_order`;
  expect(options).toEqual([
    { option_name: "Calabresa", price_cents: 4500 },
    { option_name: "Carne de Sol com Queijo Coalho", price_cents: 5600 },
    { option_name: "Catupiry", price_cents: 800 },
  ]);

  // A pizzaria aceita; o cliente passa a ver a chave Pix dela.
  const store = await (await browser.newContext()).newPage();
  await loginAs(store, "Marcos Antônio Tavares");
  await store.goto(`/lojista/pedidos/${orderId}`);
  await store.getByRole("button", { name: "Aceitar" }).click();
  await expect(store.locator('[data-testid="merchant-order-status"]:visible')).toHaveText("Aceito pela loja");
  await store.context().close();
  await page.reload();
  await expect(page.locator('[data-testid="store-pix-key"]:visible')).toHaveText("pizzaria@pix.chego.local");
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
  expect(order).toEqual({ subtotal_cents: 2400, total_cents: 2700 });
});

test("webhook do gateway: assinatura errada é recusada e evento repetido não duplica nada", async ({ request }) => {
  // Pagamento pelo app (o caminho do gateway): um Pix pendente que veio do seed.
  const [pending] = await db`
    select p.provider_payment_id, o.id as order_id from payments p join orders o on o.id = p.order_id
    where p.status = 'pending' and o.status = 'awaiting_payment' order by o.created_at desc limit 1`;
  const orderId = pending.order_id;

  const body = JSON.stringify({ id: randomUUID(), type: "payment.approved", data: { payment_id: pending.provider_payment_id } });
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
  expect(await db`select count(*)::int as total from order_status_history where order_id = ${orderId} and status = 'paid'`).toEqual([{ total: 1 }]);
  expect(await db`select count(*)::int as total from notifications where order_id = ${orderId} and type = 'order_new'`).toEqual([{ total: 1 }]);
});

test("dinheiro na entrega: troco precisa ser maior que o total e aparece para a loja", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "brasa-burger", "Batata frita");
  await addSimple(page, "brasa-burger", "Anéis de cebola");
  await page.goto("/checkout");
  // Endereço já cadastrado: vem escolhido, com o pedido para conferir (o bairro decide a taxa).
  await expect(page.locator('[data-testid="address-confirm"]:visible')).toBeVisible();
  await expect(page.getByRole("radio", { name: /Centro/ }).first()).toBeChecked();

  await page.getByRole("radio", { name: "Dinheiro na entrega" }).check();
  await page.getByLabel("Troco para quanto? (opcional)").fill("1,00");
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await expect(page.locator('[data-testid="checkout-errors"]:visible')).toContainText("O troco precisa ser para um valor maior que o total do pedido.");

  await page.getByLabel("Troco para quanto? (opcional)").fill("100,00");
  const orderId = await placeOrder(page);
  await expect(page.locator('[data-testid="payment-line"]:visible')).toContainText("Dinheiro na entrega · troco para R$ 100,00");
  const [order] = await db`select payment_method, cash_change_for_cents, total_cents from orders where id = ${orderId}`;
  expect(order).toMatchObject({ payment_method: "cash", cash_change_for_cents: 10000 });
  await expect(page.locator('[data-testid="payment-line"]:visible')).toContainText(`levar R$ ${((10000 - order.total_cents) / 100).toFixed(2).replace(".", ",")}`);
});

test("entrega pela rede do Chegô não oferece dinheiro: o entregador não leva o valor da loja", async ({ page }) => {
  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "sushi-mare", "Guioza — 6 unidades");
  await page.goto("/checkout");
  await expect(page.getByRole("radio", { name: "Pix para a loja" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dinheiro na entrega" })).toHaveCount(0);
});

test("cliente cancela antes do aceite: o estoque volta e não há reembolso pelo app", async ({ page }) => {
  const stock = async () => (await db`select stock_qty from products where name = 'Termômetro digital'`)[0].stock_qty;
  const before = await stock();

  await loginAs(page, "Ana Clara Souza");
  await addSimple(page, "farmacia-saude-mais", "Termômetro digital");
  await page.goto("/checkout");
  const orderId = await placeOrder(page);
  expect(await stock()).toBe(before - 1);

  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.locator('[data-testid="order-status"]:visible')).toHaveText("Cancelado");
  expect(await stock()).toBe(before);
  // Pagando direto à loja, nada foi cobrado pelo app: não há o que devolver por ele.
  await expect(page.locator('[data-testid="refund-note"]')).toHaveCount(0);
  const [order] = await db`select refunded_cents from orders where id = ${orderId}`;
  expect(order.refunded_cents).toBe(0);
  expect(await db`select count(*)::int as total from fee_entries where order_id = ${orderId}`).toEqual([{ total: 0 }]);
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

    await page.getByRole("radio", { name: "Remover o item (sai do total)" }).check();
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

test("compra sem conta: nome, telefone e endereço no checkout, acompanha pelo link e cancela antes do aceite", async ({ page, browser }) => {
  await addSimple(page, "brasa-burger", "Batata frita");
  await addSimple(page, "brasa-burger", "Anéis de cebola");
  await page.goto("/checkout");
  await expect(page).toHaveURL(/\/checkout$/);

  const details = page.locator('[data-testid="guest-details"]:visible');
  await details.getByLabel("Seu nome").fill("Visitante do Teste");
  await details.getByLabel("Telefone (WhatsApp)").fill("(82) 96666-1234");
  await page.getByLabel("Rua").fill("Rua do Visitante");
  await page.getByLabel("Número").fill("77");
  await page.getByLabel("Bairro ou comunidade").selectOption({ label: "Centro · entrega R$ 3,00" });
  await page.getByRole("radio", { name: "Dinheiro na entrega" }).check();
  await page.getByRole("button", { name: /^Fazer pedido/ }).click();
  await page.waitForURL(/\/acompanhar\/[A-Za-z0-9_-]{32}$/);
  await expect(page.locator('[data-testid="order-status"]:visible')).toContainText("esperando a loja aceitar");
  await expect(page.getByText("Guarde este link")).toBeVisible();

  const [order] = await db`select id, customer_id, customer_name, customer_phone, status from orders where customer_name = 'Visitante do Teste'`;
  expect(order).toMatchObject({ customer_id: null, customer_phone: "+5582966661234", status: "paid" });

  // A loja vê o pedido normalmente, marcado como "sem conta" e sem chat.
  const store = await browser.newPage();
  const [{ owner }] = await db`select p.full_name as owner from stores s join profiles p on p.id = s.owner_id where s.slug = 'brasa-burger'`;
  await loginAs(store, owner);
  await store.goto(`/lojista/pedidos/${order.id}`);
  await expect(store.getByTestId("guest-badge")).toBeVisible();
  await store.close();

  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.locator('[data-testid="order-status"]:visible')).toContainText("Cancelado");
  expect((await db`select status from orders where id = ${order.id}`)[0].status).toBe("cancelled");
});
