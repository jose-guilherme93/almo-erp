import { expect, test } from "@playwright/test";

/**
 * Proteção de rotas (FASE 02).
 *
 * Sem sessão, nenhuma rota autenticada pode ser servida — o middleware
 * redireciona para `/login` preservando o destino em `callbackUrl`.
 */

const PROTECTED_ROUTES = ["/meu", "/forbidden", "/dashboard", "/solicitacoes/nova"];

for (const route of PROTECTED_ROUTES) {
  test(`rota protegida ${route} redireciona para o login`, async ({ page }) => {
    const response = await page.goto(route);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /entrar com google/i })).toBeVisible();
  });
}

test("login preserva o destino em callbackUrl", async ({ page }) => {
  await page.goto("/meu");

  await page.waitForURL(/\/login/);

  const url = new URL(page.url());

  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("callbackUrl")).toContain("/meu");
});

test("tela de acesso negado explica o motivo informado", async ({ page }) => {
  await page.goto("/acesso-negado?motivo=domain-not-allowed");

  await expect(page.getByRole("heading", { name: /acesso não autorizado/i })).toBeVisible();
  await expect(page.getByText(/domínio corporativo autorizado/i)).toBeVisible();
});

test("tela de acesso negado usa mensagem padrão para motivo desconhecido", async ({ page }) => {
  await page.goto("/acesso-negado?motivo=motivo-inexistente");

  await expect(page.getByRole("heading", { name: /acesso não autorizado/i })).toBeVisible();
  await expect(page.getByText(/não foi possível autenticar/i)).toBeVisible();
});

test("tela de acesso negado mostra o contato do administrador", async ({ page }) => {
  await page.goto("/acesso-negado");

  await expect(page.getByRole("link", { name: /@/ })).toBeVisible();
});
