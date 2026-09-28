import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

/**
 * Cadastro de unidades (FASE 04).
 *
 * O CNPJ é validado de verdade (dígitos verificadores), então os testes usam
 * o bloco 99.999.999/xxxx, reservado para dados de teste.
 */

test.describe("lista de unidades", () => {
  test("SUPER_ADMIN vê matriz e filiais", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais");

    await expect(page.getByRole("heading", { name: "Unidades", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Matriz/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Unidade Rio de Janeiro/ }).first()).toBeVisible();
  });

  test("ADMIN_FILIAL vê apenas a própria unidade", async ({ page }) => {
    await loginAs(page, "adminFilial");
    await page.goto("/filiais");

    await expect(page.getByRole("link", { name: /Unidade São Paulo/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Unidade Rio de Janeiro/ })).toHaveCount(0);
  });

  test("filtro por UF funciona pela URL", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais?uf=RJ");

    await expect(page).toHaveURL(/uf=RJ/);
    await expect(page.getByRole("link", { name: /Unidade Rio de Janeiro/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Unidade São Paulo/ })).toHaveCount(0);
  });
});

test.describe("permissões", () => {
  test("SOLICITANTE não acessa o cadastro de unidades", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/filiais");

    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("CONSULTA pode ver a lista de unidades, sem editar", async ({ page }) => {
    await loginAs(page, "consulta");
    await page.goto("/filiais");

    await expect(page.getByRole("heading", { name: "Unidades", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nova unidade" })).toHaveCount(0);
  });

  test("ADMIN_FILIAL não vê o botão de nova unidade", async ({ page }) => {
    await loginAs(page, "adminFilial");
    await page.goto("/filiais");

    // A matriz é dona do cadastro de unidades.
    await expect(page.getByRole("link", { name: "Nova unidade" })).toHaveCount(0);
  });
});

test.describe("detalhe da unidade", () => {
  test("abre as abas e mostra os locais de estoque", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais");

    await page
      .getByRole("link", { name: /Unidade São Paulo/ })
      .first()
      .click();

    await expect(page.getByRole("heading", { name: /Unidade São Paulo/, level: 1 })).toBeVisible();

    await page.getByRole("link", { name: "Locais de estoque" }).click();
    await expect(page).toHaveURL(/aba=locais/);
    await expect(page.getByText("Almoxarifado Central").first()).toBeVisible();
  });

  test("aba de usuários lista quem atua na unidade", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais");

    await page
      .getByRole("link", { name: /Unidade São Paulo/ })
      .first()
      .click();
    // "Usuários" também é um item do menu lateral: restringimos às abas da unidade.
    await page
      .getByRole("navigation", { name: "Seções da unidade" })
      .getByRole("link", { name: "Usuários" })
      .click();

    await expect(page).toHaveURL(/aba=usuarios/);
    // O nome pode repetir quando há o mesmo usuário em mais de um domínio de
    // demonstração: basta que exista na lista da unidade.
    await expect(page.getByText("Almoxarife SP").first()).toBeVisible();
  });
});

test.describe("cadastro", () => {
  test("recusa CNPJ inválido com mensagem clara", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais/nova");

    await page.getByLabel("Código da unidade").fill("TST-E2E-1");
    await page.getByLabel("Nome da unidade").fill("Unidade de Teste E2E");
    await page.getByLabel("CNPJ").fill("11.111.111/1111-11");

    await page.getByRole("button", { name: "Cadastrar unidade" }).click();

    // O erro aparece junto do campo e também no alerta geral do formulário.
    await expect(page.locator("#cnpj-erro")).toHaveText(/Informe um CNPJ válido/i);
    await expect(page).toHaveURL(/\/filiais\/nova/);
  });

  test("mostra o primeiro passo do wizard com os campos obrigatórios", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais/nova");

    await expect(page.getByRole("button", { name: /Identificação/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Endereço e contato/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Responsáveis e operação/ })).toBeVisible();
    await expect(page.getByLabel("Código da unidade")).toBeVisible();
  });

  test("avança entre os passos sem perder o preenchimento", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/filiais/nova");

    await page.getByLabel("Código da unidade").fill("TST-E2E-2");
    await page.getByLabel("Nome da unidade").fill("Unidade Passo a Passo");

    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByLabel("CEP")).toBeVisible();

    await page.getByLabel("CEP").fill("01310-100");
    await page.getByRole("button", { name: "Voltar" }).click();

    await expect(page.getByLabel("Código da unidade")).toHaveValue("TST-E2E-2");
  });
});
