import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

/**
 * Relatórios consolidados de ponta a ponta.
 *
 * Prova o que o pedido exige: consolidar vira uma fotografia imutável (hash +
 * autor), cada saída fica registrada e não existe ação de edição do consolidado.
 */

test.describe.configure({ timeout: 120_000 });

test.describe("relatórios consolidados", () => {
  test("consolida, registra a saída e não oferece edição", async ({ page }) => {
    await loginAs(page, "superAdmin");

    // 1. Consolida o relatório (PDF sai pela impressão do navegador).
    await page.goto("/relatorios");
    await page.getByRole("button", { name: /Consolidar e imprimir/ }).click();

    await expect(page).toHaveURL(/\/relatorios\/consolidados\/[^/?]+\?consolidado=1/, {
      timeout: 20_000,
    });

    const id = page.url().match(/consolidados\/([^/?]+)/)?.[1];
    expect(id).toBeTruthy();

    // 2. O consolidado tem hash, autor e data — a evidência.
    await expect(page.getByText("Hash (SHA-256)")).toBeVisible();
    await expect(page.getByText("Consolidado por")).toBeVisible();
    await expect(page.getByText("Histórico de exportações")).toBeVisible();
    await expect(page.getByText("Impressão / PDF").first()).toBeVisible();

    // 3. Não existe ação de editar/excluir um consolidado.
    await expect(page.getByRole("button", { name: /Editar|Excluir|Apagar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Editar|Excluir|Apagar/i })).toHaveCount(0);

    // 4. Aparece no histórico de consolidados.
    await page.goto("/relatorios/consolidados");
    await expect(page.getByRole("link", { name: "Consumo por material" }).first()).toBeVisible();

    // 5. O CSV do snapshot congelado responde e mantém o separador pt-BR.
    const csv = await page.request.get(`/api/relatorios/consolidados/${id}/csv`);
    expect(csv.ok()).toBe(true);
    expect(await csv.text()).toContain(";");
  });
});
