import { expect, type Page } from "@playwright/test";

/**
 * Usuários criados pelo seed (`prisma/seed.ts`).
 *
 * Os e2e entram com eles pelo provider de credenciais de teste, que só existe
 * quando `E2E_AUTH_BYPASS` está ligado.
 */
export const TEST_USERS = {
  superAdmin: "admin@exemplo.com.br",
  adminFilial: "admin.filial@exemplo.com.br",
  gestor: "gestor@exemplo.com.br",
  almoxarife: "almoxarife@exemplo.com.br",
  solicitante: "solicitante@exemplo.com.br",
  consulta: "consulta@exemplo.com.br",
} as const;

export type TestUserKey = keyof typeof TEST_USERS;

/**
 * Faz login sem passar pelo Google.
 *
 * Usa exatamente o mesmo caminho da aplicação (mesmas regras de domínio,
 * status do usuário e permissões) — só troca o provedor de identidade.
 */
export async function loginAs(page: Page, user: TestUserKey | string): Promise<void> {
  const email = user in TEST_USERS ? TEST_USERS[user as TestUserKey] : user;

  await page.goto("/login");

  await page.getByLabel("E-mail do usuário de teste").fill(email);
  await page.getByRole("button", { name: "Entrar para teste" }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** Login e verificação de que a unidade ativa aparece no cabeçalho. */
export async function loginAndExpectBranch(
  page: Page,
  user: TestUserKey,
  branchCode: string,
): Promise<void> {
  await loginAs(page, user);
  await expect(page.getByText(branchCode, { exact: true }).first()).toBeVisible();
}
