import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

/**
 * Administração de usuários e escopo por perfil (FASE 03).
 *
 * Estes testes são a prova de que o RBAC vale de ponta a ponta: não basta a
 * permissão existir no banco, a tela precisa negar.
 */

test.describe("lista de usuários", () => {
  test("SUPER_ADMIN vê usuários de toda a rede", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/usuarios");

    await expect(page.getByRole("heading", { name: "Usuários", level: 1 })).toBeVisible();
    // Usuários de unidades diferentes convivem na mesma lista.
    // A listagem renderiza tabela (desktop) e cartões (mobile): usamos o link
    // da linha para não casar com os dois.
    await expect(
      page.getByRole("link", { name: "Administrador da Unidade SP" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuário Consulta" }).first()).toBeVisible();
  });

  test("ADMIN_FILIAL não enxerga usuário de outra unidade", async ({ page }) => {
    // "consulta" está vinculado à unidade do Rio de Janeiro.
    await loginAs(page, "adminFilial");
    await page.goto("/admin/usuarios");

    await expect(
      page.getByRole("link", { name: "Administrador da Unidade SP" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuário Consulta" })).toHaveCount(0);
  });

  test("busca filtra a lista pela URL", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/usuarios");

    await page.getByLabel("Buscar por nome ou e-mail…").fill("Almoxarife");

    await expect(page).toHaveURL(/busca=Almoxarife/);
    await expect(page.getByRole("link", { name: "Almoxarife SP" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuário Consulta" })).toHaveCount(0);
  });
});

test.describe("controle de acesso às telas de administração", () => {
  test("SOLICITANTE não acessa a lista de usuários", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/admin/usuarios");

    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByRole("heading", { name: /não tem permissão/i })).toBeVisible();
  });

  test("SOLICITANTE não vê o menu de administração", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/meu");

    await expect(page.getByRole("link", { name: "Usuários" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Perfis e permissões" })).toHaveCount(0);
  });

  test("ADMIN_FILIAL não edita perfis (só SUPER_ADMIN)", async ({ page }) => {
    await loginAs(page, "adminFilial");
    await page.goto("/admin/papeis");

    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("ADMIN_FILIAL acessa a lista de usuários da própria unidade", async ({ page }) => {
    await loginAs(page, "adminFilial");
    await page.goto("/admin/usuarios");

    await expect(page.getByRole("heading", { name: "Usuários", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Novo usuário" })).toBeVisible();
  });
});

test.describe("cadastro de usuário", () => {
  test("SUPER_ADMIN cadastra um usuário e o vê na lista", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const email = `e2e.${suffix}@exemplo.com.br`;

    await loginAs(page, "superAdmin");
    await page.goto("/admin/usuarios/novo");

    await page.getByLabel("Nome completo").fill(`Usuário E2E ${suffix}`);
    await page.getByLabel("E-mail corporativo").fill(email);

    // Perfil (Select do Radix)
    await page.getByRole("combobox", { name: "Perfil" }).click();
    await page.getByRole("option", { name: "Solicitante" }).click();

    // Unidade
    await page
      .getByRole("checkbox", { name: /Matriz/i })
      .first()
      .check();

    await page.getByRole("button", { name: "Cadastrar usuário" }).click();

    await expect(page).toHaveURL(/\/admin\/usuarios\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByText(email).first()).toBeVisible();
    await expect(page.getByText("Aguardando aprovação").first()).toBeVisible();
  });

  test("rejeita e-mail de domínio pessoal com mensagem clara", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/usuarios/novo");

    await page.getByLabel("Nome completo").fill("Pessoa Teste");
    await page.getByLabel("E-mail corporativo").fill("pessoa@gmail.com");

    await page.getByRole("combobox", { name: "Perfil" }).click();
    await page.getByRole("option", { name: "Solicitante" }).click();
    await page
      .getByRole("checkbox", { name: /Matriz/i })
      .first()
      .check();

    await page.getByRole("button", { name: "Cadastrar usuário" }).click();

    // A mensagem aparece no alerta inline e no toast: restringimos ao conteúdo
    // principal para não casar com os dois.
    await expect(
      page.getByRole("main").getByText(/não é de um domínio corporativo autorizado/i),
    ).toBeVisible();
  });
});

test.describe("perfis e permissões", () => {
  test("SUPER_ADMIN vê o catálogo de permissões agrupado", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/papeis");

    await expect(page.getByRole("heading", { name: "Perfis e permissões" })).toBeVisible();

    // Abre um perfil de sistema e confere que o catálogo veio do código.
    await page
      .getByRole("link", { name: /^Almoxarife/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/admin\/papeis\/[^/]+$/);
    await expect(page.getByText("Permissões", { exact: true }).first()).toBeVisible();

    // Os grupos de permissão vêm do catálogo em código.
    for (const group of ["Estoque", "Solicitações", "Catálogo"]) {
      await expect(page.getByText(group, { exact: true }).first()).toBeVisible();
    }

    // O Almoxarife lança estoque, logo a permissão `entrada` está marcada.
    await expect(
      page.getByRole("checkbox", { name: "Selecionar todas as permissões de Estoque" }),
    ).toBeChecked();
  });
});

test.describe("políticas de e-mail", () => {
  test("SUPER_ADMIN vê o domínio configurado e suas estatísticas", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/politicas-email");

    await expect(page.getByRole("heading", { name: "Políticas de e-mail" })).toBeVisible();
    await expect(page.getByText("exemplo.com.br").first()).toBeVisible();
  });

  test("o formulário recusa expressão regular inválida", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/politicas-email/nova");

    await page.getByLabel("Domínio corporativo").fill("teste-e2e.com.br");
    await page.getByLabel(/Regra por e-mail/).fill("([a-z");

    await expect(page.getByText(/Expressão regular inválida/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar política" })).toBeDisabled();
  });
});
