import { expect, test } from "@playwright/test";

/**
 * Smoke test — garante que a aplicação sobe e renderiza a identidade do
 * produto. Os testes de autenticação entram em `auth.spec.ts` (FASE 02).
 */
test("página inicial renderiza o nome do sistema em pt-BR", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/almo-erp/i);
  await expect(page.getByRole("heading", { name: "almo-erp" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});

test("rota inexistente devolve página 404", async ({ page }) => {
  const response = await page.goto("/rota-que-nao-existe");

  expect(response?.status()).toBe(404);
});
