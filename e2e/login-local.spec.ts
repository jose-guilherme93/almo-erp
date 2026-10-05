import { expect, test } from "@playwright/test";

/**
 * Login local (e-mail + senha), sem Google.
 *
 * A senha vem de `SEED_ADMIN_PASSWORD` no `.env` (mesmo valor documentado em
 * `.env.example`) — o seed grava o hash. O usuário é o super admin criado pelo
 * seed; a home dele é `/dashboard`.
 */

const ADMIN_EMAIL = "admin@exemplo.com.br";
const ADMIN_PASSWORD = "dev-senha-1234";

test("entra com e-mail e senha do super admin", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("E-mail", { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
});

test("recusa senha errada sem entrar", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("E-mail", { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill("senha-errada-0000");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page.getByText(/e-mail ou senha inválidos/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
