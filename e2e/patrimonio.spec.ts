import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

/**
 * Patrimônio (FASE 23).
 *
 * O caminho de ponta a ponta: um material com número de série nasce no catálogo,
 * a entrada gera um bem por série (etiqueta PAT, dono = Almoxarifado) e a ficha
 * permite colocar o bem sob a responsabilidade de alguém.
 */

test.describe.configure({ timeout: 120_000 });

function uniqueName(): string {
  return `Notebook E2E ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

test.describe("patrimônio", () => {
  test("entrada de material com série cria os bens e a posse é registrada", async ({ page }) => {
    await loginAs(page, "superAdmin");

    // 1. Material com controle por número de série (patrimônio).
    const name = uniqueName();

    await page.goto("/catalogo/itens/novo");
    await page.getByLabel("Nome do material").fill(name);

    await page.getByLabel("Unidade de medida").click();
    await page.getByRole("option").first().click();

    await page.getByRole("button", { name: "Opções avançadas" }).click();
    await page.getByRole("checkbox", { name: /Controle por número de série/ }).check();
    await page.getByRole("button", { name: "Cadastrar material" }).click();

    await expect(page).toHaveURL(/\/catalogo\/itens\/[^/]+/, { timeout: 20_000 });

    // 2. Entrada informando uma série por unidade.
    await page.goto("/estoque/entradas/nova");

    const search = page.getByLabel(/Buscar material por nome, código ou código de barras/).first();
    await search.fill(name);
    await page
      .getByRole("option", { name: new RegExp(name, "i") })
      .first()
      .click();

    await page.getByLabel(/Quantidade \(/).fill("2");
    await page.getByLabel("Números de série").fill(`SN-${Date.now()}-A, SN-${Date.now()}-B`);
    await page.getByRole("button", { name: "Lançar entrada" }).click();

    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/[^/]+/, { timeout: 20_000 });

    // 3. Os dois bens aparecem no patrimônio, sem responsável.
    await page.goto(`/patrimonio?busca=${encodeURIComponent(name)}`);

    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByText("PAT", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Almoxarifado").first()).toBeVisible();

    // 4. Coloca um bem sob responsabilidade.
    await page.getByText(name).first().click();
    await expect(page).toHaveURL(/\/patrimonio\/[^/]+/, { timeout: 20_000 });

    await page.getByLabel("Entregar a").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "Colocar sob responsabilidade" }).click();

    await expect(page.getByText("Em posse de alguém").first()).toBeVisible({ timeout: 20_000 });
  });
});
