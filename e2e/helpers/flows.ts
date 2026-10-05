import { expect, type Browser, type Page } from "@playwright/test";

import { loginAs, type TestUserKey } from "./auth";

const PORT = Number(process.env.PORT ?? 3001);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Abre uma sessão **isolada** para um usuário.
 *
 * Os fluxos de estoque envolvem mais de um perfil (quem lança, quem aprova,
 * quem recebe). Cada contexto tem seus próprios cookies, então o teste troca de
 * usuário sem precisar sair e sem herdar sessão do passo anterior.
 */
export async function openAs(browser: Browser, user: TestUserKey | string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });

  const page = await context.newPage();

  await loginAs(page, user);

  return page;
}

/** Busca um material no `ItemCombobox` e o adiciona à linha do formulário. */
export async function pickItem(page: Page, term: string): Promise<void> {
  const search = page.getByLabel(/Buscar material por nome, código ou código de barras/).first();

  await search.fill(term);
  await page
    .getByRole("option", { name: new RegExp(term, "i") })
    .first()
    .click();
}

/** Lança uma entrada de estoque e espera o documento gerado. */
export async function lancarEntrada(page: Page, term: string, quantity: string): Promise<void> {
  await page.goto("/estoque/entradas/nova");
  await pickItem(page, term);
  await page.getByLabel(/Quantidade \(/).fill(quantity);
  await page.getByRole("button", { name: "Lançar entrada" }).click();

  await expect(page).toHaveURL(/\/estoque\/movimentacoes\/[^/]+/, { timeout: 20_000 });
}

/** Extrai o id de uma URL no formato `/recurso/<id>?...`. */
export function idFromUrl(url: string, resource: string): string {
  const match = url.match(new RegExp(`/${resource}/([^/?]+)`));
  const id = match?.[1];

  if (!id) throw new Error(`Não foi possível extrair o id de ${resource} da URL ${url}`);

  return id;
}
