import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

/**
 * Dashboards por perfil (FASE 10).
 *
 * O que precisa ser provado: cada perfil cai na tela certa e não vê a tela do
 * outro.
 */

test.describe("roteamento por perfil", () => {
  test("super administrador cai no dashboard da matriz", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard da matriz" })).toBeVisible();
  });

  test("admin de unidade cai no dashboard da própria unidade", async ({ page }) => {
    await loginAs(page, "adminFilial");

    await expect(page).toHaveURL(/\/dashboard\/unidade\//);
    await expect(page.getByText("Precisa da sua resposta")).toBeVisible();
  });

  // FASE 15: quem só pede cai direto na tela de escolha (material/reparo/TI),
  // que é o ponto de partida mobile. O "Meu painel" fica na navegação.
  test("solicitante cai na tela de escolha do pedido", async ({ page }) => {
    await loginAs(page, "solicitante");

    await expect(page).toHaveURL(/\/solicitar$/);
    await expect(page.getByRole("heading", { name: "O que você precisa?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pedir material" })).toBeVisible();
  });
});

test.describe("dashboard da matriz", () => {
  test("mostra os indicadores da rede", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/dashboard");

    await expect(page.getByText("Valor total em estoque")).toBeVisible();
    await expect(page.getByText("Solicitações aguardando decisão")).toBeVisible();
    await expect(page.getByText("Transferências em trânsito")).toBeVisible();
    await expect(page.getByText("Itens abaixo do mínimo")).toBeVisible();

    // Tabela de pendências por unidade.
    await expect(page.getByText("Pendências por unidade")).toBeVisible();
  });

  test("visão por unidade lista todas as unidades", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/dashboard/unidades");

    await expect(page.getByRole("heading", { name: "Visão por unidade" })).toBeVisible();
    // Na tabela comparativa o nome da unidade é texto; o link é o botão "Abrir".
    await expect(page.getByText("Unidade Rio de Janeiro").first()).toBeVisible();
    await expect(page.getByText("Comparativo operacional de toda a rede.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir" }).first()).toBeVisible();
  });
});

test.describe("dashboard da unidade", () => {
  test("o admin da unidade vê o painel de chamados", async ({ page }) => {
    await loginAs(page, "adminFilial");

    await expect(page.getByText("Precisa da sua resposta")).toBeVisible();
    await expect(page.getByText("Notificações não lidas")).toBeVisible();
    await expect(page.getByText("Itens abaixo do mínimo")).toBeVisible();
  });

  test("o admin da unidade não acessa o dashboard de outra unidade", async ({ page }) => {
    await loginAs(page, "adminFilial");

    // Descobre o id de outra unidade pela listagem (que ele enxerga).
    await page.goto("/dashboard/unidade/unidade-inexistente");

    await expect(page).toHaveURL(/\/forbidden|\/not-found/);
  });

  test("solicitante não acessa dashboard de unidade", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/dashboard/unidade/qualquer");

    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("solicitante não vê o menu de dashboard da matriz", async ({ page }) => {
    await loginAs(page, "solicitante");

    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
  });
});

test.describe("notificações", () => {
  test("caixa de entrada acessível a qualquer usuário", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/notificacoes");

    await expect(page.getByRole("heading", { name: "Notificações" })).toBeVisible();
  });

  test("sino aparece na barra superior", async ({ page }) => {
    await loginAs(page, "adminFilial");

    await expect(page.getByRole("button", { name: /Notificações/ })).toBeVisible();
  });
});
