import { expect, test } from "@playwright/test";
import { db, freshDatabase, loginAs, loginWithPhone, placePaidOrder, visible } from "./helpers";

// Uma sexta às 15h: a Força Total Suplementos (que entrega pela rede do Chegô) está aberta.
test.beforeAll(() => freshDatabase("2026-10-09T15:00"));

test("entregador parceiro se cadastra com CPF ou CNPJ, espera a aprovação e o admin aprova", async ({ page }) => {
  await page.goto("/quero-entregar");
  await page.getByLabel("Seu nome completo").fill("Tiago Motoboy da Silva");
  await page.getByLabel("Telefone com DDD").fill("(82) 95555-0101");
  await page.getByLabel("Crie uma senha").fill("senha-do-tiago");
  await page.getByLabel("Cidade onde você entrega").selectOption({ label: "Joaquim Gomes – AL" });

  // CPF com dígito verificador errado é recusado, e o que foi digitado continua lá.
  await page.getByLabel("Número do documento (CPF)").fill("12345678900");
  await expect(page.getByLabel("Número do documento (CPF)")).toHaveValue("123.456.789-00");
  await page.getByLabel("Placa do veículo").fill("abc1d23");
  await page.getByRole("button", { name: "Enviar cadastro" }).click();
  await expect(page.getByText("Esse CPF não existe. Confira os números.")).toBeVisible();
  await expect(page.getByLabel("Seu nome completo")).toHaveValue("Tiago Motoboy da Silva");

  // Trocando para CNPJ, o campo muda de tamanho e de pontuação.
  await page.getByRole("radio", { name: /CNPJ/ }).check();
  await page.getByLabel("Número do documento (CNPJ)").fill("11222333000181");
  await expect(page.getByLabel("Número do documento (CNPJ)")).toHaveValue("11.222.333/0001-81");
  await page.getByRole("button", { name: "Enviar cadastro" }).click();
  await expect(page.getByText("Para continuar, aceite os Termos de Uso.")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enviar cadastro" }).click();
  await expect(page.getByText("Recebemos o seu cadastro!")).toBeVisible();

  const [saved] = await db`
    select c.kind, c.status, c.document_type, c.document_number, c.plate, p.role
    from couriers c join profiles p on p.id = c.profile_id where p.phone = '+5582955550101'`;
  expect(saved).toEqual({ kind: "partner", status: "pending", document_type: "cnpj", document_number: "11222333000181", plate: "ABC1D23", role: "courier" });

  // Enquanto não é aprovado, ele entra mas não vê nenhuma entrega.
  await loginWithPhone(page, "(82) 95555-0101", "senha-do-tiago");
  await expect(page).toHaveURL(/\/entregador$/);
  await expect(visible(page, "courier-waiting")).toContainText("Seu cadastro está em análise.");
  await expect(visible(page, "courier-offer")).toHaveCount(0);

  await loginAs(page, "Admin Chegô");
  await page.goto("/admin/entregadores?situacao=pending");
  const row = visible(page, "admin-courier").filter({ hasText: "Tiago Motoboy da Silva" });
  await expect(row).toContainText("CNPJ 11.222.333/0001-81");
  await expect(row).toContainText("Entregador parceiro");
  await row.getByRole("button", { name: "Aprovar Tiago Motoboy da Silva" }).click();
  await expect(row).toHaveCount(0);

  await loginWithPhone(page, "(82) 95555-0101", "senha-do-tiago");
  await expect(page.getByRole("button", { name: "Ficar disponível" })).toBeVisible();
  // Parado, ele não vê as entregas; disponível, vê as que estão esperando.
  await expect(page.getByRole("heading", { name: "Entregas disponíveis" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ficar disponível" }).click();
  await expect(page.getByRole("heading", { name: "Entregas disponíveis" })).toBeVisible();
  await expect(visible(page, "courier-offer").first()).toContainText("Você ganha");
});

test("entrega pela rede do Chegô: o entregador pega, retira, entrega com o código e ganha a taxa", async ({ page, browser }) => {
  const orderId = await placePaidOrder(page, "Ana Clara Souza", "forca-total-suplementos", ["Creatina 300 g"]);
  const [order] = await db`
    select code, delivery_code, delivery_provider, delivery_fee_cents, courier_fee_cents, subtotal_cents, commission_cents,
           service_fee_cents, store_amount_cents, platform_amount_cents
    from orders where id = ${orderId}`;
  // A taxa de entrega (Centro, R$ 3,00) não vai para a loja: fica do lado da plataforma, que paga o entregador.
  expect(order).toMatchObject({ delivery_provider: "platform", delivery_fee_cents: 300, courier_fee_cents: 300 });
  expect(order.store_amount_cents).toBe(order.subtotal_cents - order.commission_cents);
  expect(order.platform_amount_cents).toBe(order.commission_cents + order.service_fee_cents + 300);

  // Antes de a loja aceitar, a entrega ainda não é oferecida.
  const courierPage = await (await browser.newContext()).newPage();
  await loginAs(courierPage, "Wesley Santana");
  await expect(courierPage).toHaveURL(/\/entregador$/);
  const offer = () => visible(courierPage, "courier-offer").filter({ hasText: order.code });
  await expect(offer()).toHaveCount(0);

  await loginAs(page, "Rafael Guedes");
  const card = () => visible(page, "merchant-order").filter({ hasText: order.code });
  await card().getByRole("button", { name: "Aceitar" }).click();
  await expect(card().getByTestId("network-courier")).toHaveText("Entrega pelo Chegô: procurando um entregador.");

  // A oferta mostra de onde sai, para onde vai e quanto paga, mas não quem é o cliente.
  await courierPage.reload();
  await expect(offer()).toContainText("Força Total Suplementos");
  await expect(offer()).toContainText("Entregar em Centro");
  await expect(offer()).toContainText("Você ganha R$ 3,00");
  await expect(offer()).not.toContainText("Ana Clara");
  await expect(offer()).not.toContainText("Rua do Comércio");
  const [notice] = await db`select count(*)::int as total from notifications where type = 'delivery_offer' and order_id = ${orderId}`;
  expect(notice.total).toBeGreaterThanOrEqual(1);

  await offer().getByRole("button", { name: "Pegar entrega" }).click();
  const mine = () => visible(courierPage, "courier-delivery").filter({ hasText: order.code });
  await expect(mine()).toContainText("Retirar em");
  await expect(mine()).toContainText("A loja ainda está preparando.");
  await expect(mine()).not.toContainText("Rua do Comércio");

  // Outro entregador já não vê essa entrega.
  const other = await (await browser.newContext()).newPage();
  await loginAs(other, "Jonas Ferreira");
  await expect(visible(other, "courier-offer").filter({ hasText: order.code })).toHaveCount(0);
  await other.context().close();

  // A loja vê quem vem buscar e não tem o botão de despachar: quem tira o pedido da loja é o entregador.
  await page.reload();
  await expect(card().getByTestId("network-courier")).toHaveText("Entregador do Chegô: Wesley");
  await card().getByRole("button", { name: "Começar o preparo" }).click();
  await card().getByRole("button", { name: "Marcar como pronto" }).click();
  await expect(card().getByRole("button", { name: "Saiu para entrega" })).toHaveCount(0);

  await courierPage.reload();
  await mine().getByRole("button", { name: "Retirei o pedido" }).click();
  // Só agora, com o pedido na mão, o entregador vê o cliente e o endereço.
  await expect(mine()).toContainText("Ana Clara Souza");
  await expect(mine()).toContainText("Rua do Comércio, 120");
  await expect(mine().getByRole("link", { name: "Abrir no mapa" })).toHaveAttribute("href", /google\.com\/maps/);

  const wrong = order.delivery_code === "0000" ? "1111" : "0000";
  await mine().getByLabel("Código de entrega (peça ao cliente)").fill(wrong);
  await mine().getByRole("button", { name: "Entreguei" }).click();
  await expect(mine().getByText("Código errado.")).toBeVisible();
  await mine().getByLabel("Código de entrega (peça ao cliente)").fill(order.delivery_code);
  await mine().getByRole("button", { name: "Entreguei" }).click();
  await expect(mine()).toHaveCount(0);

  // O ganho aparece para o entregador e nos lançamentos: sai da plataforma, entra para ele.
  const earning = visible(courierPage, "courier-earning").filter({ hasText: order.code });
  await expect(earning).toContainText("R$ 3,00");
  await expect(earning).toContainText("A receber");
  const lines = await db`
    select account::text, direction::text, amount_cents from ledger_entries where order_id = ${orderId} and reason = 'delivery' order by account`;
  expect(lines).toEqual([
    { account: "courier", direction: "credit", amount_cents: 300 },
    { account: "platform", direction: "debit", amount_cents: 300 },
  ]);
  const history = await db`select status from order_status_history where order_id = ${orderId} order by created_at`;
  expect(history.map((row) => row.status)).toEqual(["awaiting_payment", "paid", "accepted", "preparing", "ready", "out_for_delivery", "delivered"]);

  // O cliente vê o pedido entregue.
  await loginAs(page, "Ana Clara Souza");
  await page.goto(`/pedidos/${orderId}`);
  await expect(visible(page, "order-status")).toHaveText("Entregue");

  // O admin registra o repasse e o entregador passa a ver como repassado.
  await loginAs(page, "Admin Chegô");
  await page.goto("/admin/entregadores");
  const row = visible(page, "admin-courier").filter({ hasText: "Wesley Santana" });
  await expect(row).toContainText("Entregador do Chegô");
  await row.getByRole("button", { name: /^Marcar repasse de/ }).click();
  // Depois do repasse não sobra nada a receber, e o botão some.
  await expect(row).toContainText("a receber R$ 0,00");
  await expect(row.getByRole("button", { name: /^Marcar repasse de/ })).toHaveCount(0);
  await courierPage.reload();
  await expect(visible(courierPage, "courier-earning").filter({ hasText: order.code })).toContainText("Repassado");
  await courierPage.context().close();
});

test("entregador desiste antes de retirar e a entrega volta para a fila; bloqueado não entrega", async ({ page }) => {
  const [waiting] = await db`
    select o.id, o.code from orders o join stores s on s.id = o.store_id
    where s.slug = 'sushi-mare' and o.status = 'ready' and o.courier_id is null`;

  await loginAs(page, "Jonas Ferreira");
  const offer = () => visible(page, "courier-offer").filter({ hasText: waiting.code });
  await expect(offer()).toContainText("já está pronto");
  await offer().getByRole("button", { name: "Pegar entrega" }).click();
  const mine = () => visible(page, "courier-delivery").filter({ hasText: waiting.code });
  await expect(mine().getByRole("button", { name: "Retirei o pedido" })).toBeVisible();

  await mine().getByRole("button", { name: "Desistir desta entrega" }).click();
  await expect(mine()).toHaveCount(0);
  await expect(offer()).toBeVisible();
  expect((await db`select courier_id from orders where id = ${waiting.id}`)[0].courier_id).toBeNull();

  // Ele já tem uma entrega na rua (do seed); com duas, não pega a terceira.
  await offer().getByRole("button", { name: "Pegar entrega" }).click();
  await expect(mine()).toBeVisible();
  const [second] = await db`
    select o.code from orders o join stores s on s.id = o.store_id where s.slug = 'casa-da-lasanha' and o.status = 'preparing' and o.courier_id is null`;
  const next = visible(page, "courier-offer").filter({ hasText: second.code });
  await next.getByRole("button", { name: "Pegar entrega" }).click();
  await expect(next.getByText("Você já está com 2 entregas.")).toBeVisible();

  // Quem foi bloqueado entra, mas só vê o aviso; quem é de loja ou cliente não entra no painel.
  await loginAs(page, "Marcelo Dias");
  await expect(visible(page, "courier-waiting")).toContainText("Seu cadastro está bloqueado.");
  await expect(visible(page, "courier-waiting")).toContainText("Duas entregas não concluídas sem aviso");
  await loginAs(page, "Ana Clara Souza");
  await page.goto("/entregador");
  await expect(page).not.toHaveURL(/\/entregador/);
});

test("a loja escolhe quem faz a entrega e a mudança vale para os próximos pedidos", async ({ page }) => {
  await loginAs(page, "Thiago Bezerra");
  await page.goto("/lojista/loja");
  await expect(page.getByRole("radio", { name: /Meu entregador/ })).toBeChecked();
  await page.getByRole("radio", { name: /Entregadores do Chegô/ }).check();
  await page.getByRole("button", { name: "Salvar dados da loja" }).click();
  await expect(page.getByText("Dados da loja salvos.")).toBeVisible();

  const [store] = await db`select delivery_provider from stores where slug = 'brasa-burger'`;
  expect(store.delivery_provider).toBe("platform");
  // Os pedidos que já existiam continuam com a loja.
  const [old] = await db`
    select count(*)::int as total from orders o join stores s on s.id = o.store_id where s.slug = 'brasa-burger' and o.delivery_provider = 'platform'`;
  expect(old.total).toBe(0);
});
