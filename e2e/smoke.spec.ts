import { expect, test } from "@playwright/test";

/**
 * Smoke test do almo-erp (FASE 00).
 *
 * Garante que a aplicação sobe, serve HTML em pt-BR e que a entrada do
 * sistema manda quem não está logado para o login.
 */

test("raiz redireciona usuário anônimo para o login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login/);
});

test("tela de login renderiza em pt-BR com a ação do Google", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle(/almo-erp/i);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByRole("button", { name: /entrar com google/i })).toBeVisible();
  await expect(page.getByText(/acesso restrito a usuários autorizados/i)).toBeVisible();
});

test("rota inexistente também vai para o login quando não há sessão", async ({ page }) => {
  // O gate de sessão roda antes do roteamento: qualquer rota desconhecida
  // com usuário anônimo cai no login, não em um 404.
  await page.goto("/rota-que-nao-existe");

  await expect(page).toHaveURL(/\/login/);
});
