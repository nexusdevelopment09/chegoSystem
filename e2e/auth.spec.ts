import { expect, test } from "@playwright/test";
import { createAccount, db, freshDatabase, loginAs, loginWithPhone } from "./helpers";

test.beforeAll(() => freshDatabase());

test("o link abre direto nas lojas; 'Entrar' no topo leva cliente, lojista, entregador e admin às suas entradas", async ({ page }) => {
  await page.goto("/");
  // Sem tela de boas-vindas nem escolha de bairro antes das lojas.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Abertas agora" })).toBeVisible();
  await expect(page.getByLabel("Seu bairro ou comunidade")).toHaveCount(0);

  const menu = page.getByTestId("signin-menu");
  await menu.getByText("Entrar", { exact: true }).click();
  for (const [label, href] of [["Cliente", "/entrar"], ["Lojista", "/entrar/loja"], ["Entregador", "/entrar/entregador"], ["Administrador", "/entrar/senha"]]) {
    await expect(menu.getByRole("link", { name: new RegExp("^" + label) })).toHaveAttribute("href", href);
  }
  await menu.getByRole("link", { name: /^Cliente/ }).click();
  await expect(page.getByRole("heading", { name: "Entrar para pedir" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Criar minha conta" })).toBeVisible();

  await page.goto("/");
  await page.getByTestId("signin-menu").getByText("Entrar", { exact: true }).click();
  await page.getByTestId("signin-menu").getByRole("link", { name: /^Lojista/ }).click();
  await expect(page).toHaveURL(/\/entrar\/loja$/);
  await expect(page.getByRole("heading", { name: "Área do lojista" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cadastrar minha loja" })).toHaveAttribute("href", "/quero-vender");
  // Dono da Açaí Tropical, com a senha dos usuários de teste.
  await page.getByLabel("Seu telefone com DDD").fill("(82) 91000-0001");
  await page.getByLabel("Senha", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/lojista/);

  await page.context().clearCookies();
  await page.goto("/entrar");
  await page.getByRole("link", { name: /Sou entregador/ }).click();
  await expect(page.getByRole("heading", { name: "Área do entregador" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quero ser entregador" })).toHaveAttribute("href", "/quero-entregar");

  // Quem só quer olhar volta para as lojas, sem escolher bairro.
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Só quero ver as lojas" }).click();
  await expect(page.getByRole("heading", { name: "Abertas agora" })).toBeVisible();
});

test("no ambiente de testes, 0000 e senha 0000 entram na conta de demonstração de cada área", async ({ page }) => {
  const enter = async (path: string) => {
    await page.context().clearCookies();
    await page.goto(path);
    await page.getByLabel("Seu telefone com DDD").fill("0000");
    await page.getByLabel("Senha", { exact: true }).fill("0000");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
  };

  await enter("/entrar");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/perfil");
  await expect(page.getByLabel("Nome completo")).toHaveValue("Ana Clara Souza");

  await enter("/entrar/loja");
  await expect(page).toHaveURL(/\/lojista/);
  await expect(page.getByText("Pizzaria Forno de Barro").first()).toBeVisible();

  await enter("/entrar/entregador");
  await expect(page).toHaveURL(/\/entregador$/);
  await expect(page.getByRole("heading", { name: /Oi, Wesley/ })).toBeVisible();

  // Senha errada continua recusada.
  await page.context().clearCookies();
  await page.goto("/entrar");
  await page.getByLabel("Seu telefone com DDD").fill("0000");
  await page.getByLabel("Senha", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Oxe, esse telefone não parece certo.")).toBeVisible();
});

test("cliente novo cria a conta com nome, telefone, senha e aceite dos termos", async ({ page }) => {
  await createAccount(page, "Maria Teste da Silva", "(82) 98888-1234", "minha-senha-boa");

  // Já entra na conta e vai direto para as lojas.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Abertas agora" })).toBeVisible();
  await page.goto("/perfil");
  await expect(page.getByLabel("Nome completo")).toHaveValue("Maria Teste da Silva");
  await expect(page.getByText("(82) 98888-1234")).toBeVisible();

  const [profile] = await db`
    select p.role, p.password_hash, (select count(*)::int from legal_acceptances a where a.profile_id = p.id) as accepted
    from profiles p where p.phone = '+5582988881234'`;
  expect(profile.role).toBe("customer");
  expect(profile.password_hash).toMatch(/^scrypt\$/);
  expect(profile.password_hash).not.toContain("minha-senha-boa");
  expect(profile.accepted).toBe(2);

  // Depois de sair, entra de novo com o telefone e a senha.
  await page.context().clearCookies();
  await loginWithPhone(page, "(82) 98888-1234", "minha-senha-boa");
  await expect(page).toHaveURL(/\/$/);
});

test("criar conta recusa senha fácil e telefone que já tem conta", async ({ page }) => {
  await createAccount(page, "Pedro Teste", "(82) 98888-5678", "11111111");
  await expect(page.getByText("Essa senha é fácil demais de adivinhar.")).toBeVisible();
  // O que foi digitado continua lá.
  await expect(page.getByLabel("Seu nome completo")).toHaveValue("Pedro Teste");

  await createAccount(page, "Outra Ana", "82940000001", "senha-qualquer");
  await expect(page.getByText("Esse telefone já tem conta no Chegô. Entre com a sua senha.")).toBeVisible();
  const [{ count }] = await db`select count(*)::int as count from profiles where phone in ('+5582988885678')`;
  expect(count).toBe(0);
});

test("cliente que já existe entra com telefone e senha", async ({ page }) => {
  await loginWithPhone(page, "82940000001");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/perfil");
  await expect(page.getByLabel("Nome completo")).toHaveValue("Ana Clara Souza");
});

test("senha errada e telefone inválido mostram o motivo", async ({ page }) => {
  await loginWithPhone(page, "12345", "qualquer-coisa");
  await expect(page.getByText("Oxe, esse telefone não parece certo.")).toBeVisible();

  await loginWithPhone(page, "82940000002", "senha-errada");
  await expect(page.getByText("Telefone ou senha incorretos.")).toBeVisible();
  // Telefone sem conta recebe a mesma resposta: a tela não conta quem é cliente.
  await loginWithPhone(page, "82977776666", "senha-errada");
  await expect(page.getByText("Telefone ou senha incorretos.")).toBeVisible();
});

test("o cliente troca a senha em Meu perfil", async ({ page }) => {
  await loginWithPhone(page, "82940000003");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/perfil");
  await page.getByLabel("Senha atual").fill("errada");
  await page.getByLabel("Nova senha").fill("nova-senha-da-carla");
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByText("A senha atual não confere.")).toBeVisible();

  await page.getByLabel("Senha atual").fill("123456");
  await page.getByLabel("Nova senha").fill("nova-senha-da-carla");
  await page.getByRole("button", { name: "Trocar senha" }).click();
  await expect(page.getByText("Senha trocada.")).toBeVisible();

  await page.context().clearCookies();
  await loginWithPhone(page, "82940000003", "123456");
  await expect(page.getByText("Telefone ou senha incorretos.")).toBeVisible();
  await loginWithPhone(page, "82940000003", "nova-senha-da-carla");
  await expect(page).toHaveURL(/\/$/);
});

test("quem esqueceu a senha recebe uma provisória do admin", async ({ page }) => {
  const [customer] = await db`select id from profiles where phone = '+5582940000004'`;
  await loginAs(page, "Admin Chegô");
  await page.goto(`/admin/clientes/${customer.id}`);
  await page.getByRole("button", { name: "Gerar senha nova" }).click();
  const note = await page.getByText(/Senha provisória de .*: \d{8}/).textContent();
  const password = note!.match(/\d{8}/)![0];

  await page.context().clearCookies();
  await loginWithPhone(page, "82940000004", "123456");
  await expect(page.getByText("Telefone ou senha incorretos.")).toBeVisible();
  await loginWithPhone(page, "82940000004", password);
  await expect(page).toHaveURL(/\/$/);
});

test("cada papel só entra no seu painel", async ({ page }) => {
  // Sem ter entrado.
  for (const path of ["/admin", "/lojista", "/perfil"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/entrar$/);
  }

  await loginAs(page, "Ana Clara Souza");
  for (const path of ["/admin", "/lojista"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
  }

  await loginAs(page, "Robson Entregas");
  await expect(page).toHaveURL(/\/lojista\/entregas$/);
  await expect(page.getByRole("heading", { name: "Minhas entregas" })).toBeVisible();
  // Sem permissão de admin, volta para a página inicial (as lojas).
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);

  await loginWithPhone(page, "82900000000", "admin");
  await expect(page).toHaveURL(/\/admin$/);
});

test("cliente bloqueado entra, mas vê o aviso de bloqueio", async ({ page }) => {
  await loginAs(page, "Henrique Costa");
  await page.goto("/perfil");
  await expect(page.getByText("Sua conta está bloqueada para novos pedidos.")).toBeVisible();
});

test("nova versão dos termos precisa ser aceita no próximo acesso", async ({ page }) => {
  await loginAs(page, "Carla Mendes");
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();

  const [document] = await db`
    insert into legal_documents (type, version, title, content, published_at)
    values ('terms', 2, 'Termos de Uso', '[TEXTO PROVISÓRIO] Versão 2.', now())
    returning id`;
  try {
    await page.goto("/perfil");
    await expect(page).toHaveURL(/\/termos\/aceitar$/);
    await expect(page.getByRole("heading", { name: "Atualizamos nossos termos" })).toBeVisible();

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Aceitar e continuar" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();
  } finally {
    // Outros testes entram como usuários que nunca viram a versão 2.
    await db`delete from legal_acceptances where document_id = ${document.id}`;
    await db`delete from legal_documents where id = ${document.id}`;
  }
});

test("sair de todos os aparelhos encerra a sessão", async ({ page }) => {
  await loginAs(page, "Bruno Henrique Lima");
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Sair de todos os aparelhos" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto("/perfil");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("as páginas de termos são públicas", async ({ page }) => {
  await page.goto("/termos/privacidade");
  await expect(page.getByRole("heading", { name: "Política de Privacidade" })).toBeVisible();
  await expect(page.getByText("[TEXTO PROVISÓRIO]")).toBeVisible();
});
