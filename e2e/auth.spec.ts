import { expect, test } from "@playwright/test";
import { db, loginAs, loginWithPhone } from "./helpers";

test("cliente novo se cadastra com telefone, nome e aceite dos termos", async ({ page }) => {
  await loginWithPhone(page, "(82) 98888-1234");

  await expect(page).toHaveURL(/\/cadastro$/);
  await page.getByLabel("Seu nome completo").fill("Maria Teste da Silva");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar minha conta" }).click();

  // A brand-new customer has no address yet, so they choose where they are.
  await expect(page).toHaveURL(/\/boas-vindas$/);
  await page.goto("/perfil");
  await expect(page.getByText("Maria Teste da Silva")).toBeVisible();
  await expect(page.getByText("(82) 98888-1234")).toBeVisible();

  const [profile] = await db`
    select p.role, p.accepted_terms_at, (select count(*)::int from legal_acceptances a where a.profile_id = p.id) as accepted
    from profiles p where p.phone = '+5582988881234'`;
  expect(profile.role).toBe("customer");
  expect(profile.accepted_terms_at).not.toBeNull();
  expect(profile.accepted).toBe(2);
});

test("sem aceitar os termos o cadastro não termina", async ({ page }) => {
  await loginWithPhone(page, "(82) 98888-5678");
  await expect(page).toHaveURL(/\/cadastro$/);

  // Leaving the sign-up half done sends the user back to it.
  await page.goto("/perfil");
  await expect(page).toHaveURL(/\/cadastro$/);
});

test("cliente que já existe entra direto com o código", async ({ page }) => {
  await loginWithPhone(page, "82940000001");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/perfil");
  await expect(page.getByText("Ana Clara Souza")).toBeVisible();
});

test("código errado e telefone inválido mostram o motivo", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("Seu telefone com DDD").fill("12345");
  await page.getByRole("button", { name: "Receber código" }).click();
  await expect(page.getByText("Oxe, esse telefone não parece certo.")).toBeVisible();

  await loginWithPhone(page, "82940000002", "000000");
  await expect(page.getByText("Código errado. Confere e tenta de novo.")).toBeVisible();
});

test("o código enviado aparece na caixa de mensagens e nenhum SMS real sai", async ({ page }) => {
  await loginWithPhone(page, "82940000003");
  await page.goto("/dev");
  await expect(page.getByText("Chegô: seu código é 123456.").first()).toBeVisible();
});

test("cada papel só entra no seu painel", async ({ page }) => {
  // Not signed in.
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
  await expect(page).toHaveURL(/\/lojista$/);
  await expect(page.getByText("Pizzaria Forno de Barro · Entregador")).toBeVisible();
  // A courier has no address, so the home page sends him on to choose a city.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/boas-vindas$/);

  await loginWithPhone(page, "82900000000");
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
    // Other tests sign in as users who never saw version 2.
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
