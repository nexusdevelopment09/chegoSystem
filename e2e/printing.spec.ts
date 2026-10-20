import { expect, test, type Page } from "@playwright/test";
import { db, freshDatabase, loginAs, placePaidOrder, setClock, visible } from "./helpers";

// Impressão térmica Bluetooth. Sem impressora física aqui: só o hardware é simulado, com uma
// porta serial de mentira no lugar da Web Serial do Chrome (guarda os bytes recebidos). A tela,
// o servidor, a fila e o cupom ESC/POS são os de verdade. O teste com a impressora real fica
// no roteiro (docs/IMPRESSAO_TERMICA.md).

// Uma sexta às 20h: a Pizzaria Forno de Barro está aberta.
test.beforeAll(() => freshDatabase("2026-10-09T20:00"));
test.afterAll(() => setClock(null));

const OWNER = "Marcos Antônio Tavares";

/** Porta serial Bluetooth de mentira. A permissão "lembrada" pelo Chrome sobrevive a recarregar a página. */
async function fakeSerial(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: number[]; __failWrites: boolean };
    w.__printed = [];
    w.__failWrites = false;
    const port = {
      open: async () => {},
      close: async () => {},
      getInfo: () => ({ bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          if (w.__failWrites) throw Object.assign(new Error("impressora sem resposta"), { name: "NetworkError" });
          w.__printed.push(...chunk);
        },
      }),
    };
    const granted = sessionStorage.getItem("fake-granted") ? [port] : [];
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => {
          if (!granted.includes(port)) granted.push(port);
          sessionStorage.setItem("fake-granted", "1");
          return port;
        },
        getPorts: async () => granted,
      },
    });
  });
}

const printed = (page: Page) => page.evaluate(() => {
  const bytes = (window as unknown as { __printed: number[] }).__printed;
  // Linhas quebradas na largura do papel viram um texto só, para procurar frases inteiras.
  return String.fromCharCode(...bytes).replace(/\n/g, " ").replace(/ +/g, " ");
});

test("cadastra a impressora, conecta pelo Bluetooth, imprime teste, pedido automático e reimpressão", async ({ page, browser }) => {
  await fakeSerial(page);
  await loginAs(page, OWNER);
  await page.goto("/lojista/impressoras");
  await expect(page.getByText("Nenhuma impressora cadastrada.")).toBeVisible();

  await page.getByLabel("Nome da impressora").fill("Impressora do Caixa");
  await page.getByLabel("Largura do papel").selectOption("58");
  await page.getByLabel("Vias").fill("1");
  await page.getByLabel("Imprimir sozinha quando chegar pedido novo").check();
  await page.getByRole("button", { name: "Cadastrar impressora" }).click();
  await expect(page.getByText("Impressora cadastrada.")).toBeVisible();

  const printer = page.locator('[data-testid="printer"]:visible', { hasText: "Impressora do Caixa" });
  await expect(printer.getByTestId("printer-state")).toHaveText("Desconectada");
  await printer.getByRole("button", { name: "Conectar pelo Bluetooth" }).click();
  await expect(printer.getByTestId("printer-state")).toHaveText("Conectada");
  await expect(printer.getByText("Conectada neste celular.")).toBeVisible();
  const [saved] = await db`select device_id, device_label, auto_since is not null as auto from store_printers where name = 'Impressora do Caixa'`;
  expect(saved.device_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(saved.auto).toBe(true);

  // Teste: o cupom chega à "impressora" com o nome da loja e da impressora.
  await printer.getByRole("button", { name: "Imprimir teste" }).click();
  await expect(printer.getByText(/Teste enviado para a impressora/)).toBeVisible();
  const testTicket = await printed(page);
  expect(testTicket).toContain("Pizzaria Forno de Barro");
  expect(testTicket).toContain("Impressora: Impressora do Caixa");
  expect(testTicket).toContain("Papel de 58 mm (32 colunas)");
  // "ç" e "ã" na tabela CP860 (0x87 e 0x84), não "?".
  expect(testTicket).toContain("Cora\x87\x84o");
  await printer.getByText(/^Histórico/).click();
  await expect(printer.getByTestId("print-history")).toContainText("Enviado");
  await expect(visible(page, "print-station")).toContainText("conectada");

  // Pedido novo: sai sozinho, uma vez, sem ninguém tocar em nada.
  const customer = await (await browser.newContext()).newPage();
  const orderId = await placePaidOrder(customer, "Ana Clara Souza", "pizzaria-forno-de-barro", ["Refrigerante 2 L", "Suco natural 500 ml", "Refrigerante lata"]);
  await customer.context().close();
  const [order] = await db`select code from orders where id = ${orderId}`;
  await expect.poll(async () => (await printed(page)).includes(`Pedido ${order.code}`), { timeout: 30_000 }).toBe(true);
  const ticket = await printed(page);
  expect(ticket).toContain("Refrigerante 2 L");
  expect(ticket).toContain("TOTAL");
  await expect.poll(async () => (await db`select status from print_jobs where order_id = ${orderId} and not reprint`).map((row) => row.status)).toEqual(["sent"]);

  // Recarregar a página não imprime de novo.
  await page.reload();
  await page.waitForTimeout(9_000);
  expect((await printed(page)).includes(`Pedido ${order.code}`)).toBe(false);
  expect((await db`select count(*)::int as n from print_jobs where order_id = ${orderId}`)[0].n).toBe(1);

  // Reimpressão manual da comanda da cozinha, na página do pedido.
  await page.goto(`/lojista/pedidos/${orderId}`);
  const reprint = visible(page, "reprint");
  await reprint.getByLabel("Cupom").selectOption("cozinha");
  await reprint.getByRole("button", { name: "Imprimir" }).click();
  await expect(reprint.getByText(/Enviado para a fila/)).toBeVisible();
  const kitchen = await printed(page);
  expect(kitchen).toContain("COZINHA");
  expect(kitchen).toContain(`Pedido ${order.code}`);
  expect(kitchen).not.toContain("R$");
  // O status do pedido não muda por ter sido impresso.
  expect((await db`select status from orders where id = ${orderId}`)[0].status).toBe("paid");
});

test("falha de envio aparece na tela e no histórico, e o teste pode ser repetido", async ({ page }) => {
  await fakeSerial(page);
  await loginAs(page, OWNER);
  await page.goto("/lojista/impressoras");
  const printer = page.locator('[data-testid="printer"]:visible', { hasText: "Impressora do Caixa" });
  // Outro navegador = outro celular: a impressora está ligada ao aparelho do teste anterior.
  await printer.getByRole("button", { name: "Conectar neste celular" }).click();
  await expect(printer.getByTestId("printer-state")).toHaveText("Conectada");
  await page.evaluate(() => { (window as unknown as { __failWrites: boolean }).__failWrites = true; });
  await printer.getByRole("button", { name: "Imprimir teste" }).click();
  await expect(printer.getByText(/Falha no envio/)).toBeVisible();
  await expect(printer.getByTestId("printer-state")).toHaveText("Erro");
  await printer.getByText(/^Histórico/).click();
  await expect(printer.getByTestId("print-history")).toContainText("Falhou");
});

test("sem Web Serial (navegador sem suporte), a tela explica o que fazer", async ({ page }) => {
  // Remove a Web Serial do navegador (como no Safari, no Firefox ou num Chrome antigo).
  await page.addInitScript(() => { delete (Navigator.prototype as unknown as { serial?: unknown }).serial; });
  await loginAs(page, OWNER);
  await page.goto("/lojista/impressoras");
  const printer = page.locator('[data-testid="printer"]:visible', { hasText: "Impressora do Caixa" });
  await expect(printer.getByRole("alert")).toContainText("Use o Chrome atualizado num celular Android");
  await expect(printer.getByRole("button", { name: "Conectar pelo Bluetooth" })).toHaveCount(0);
});
