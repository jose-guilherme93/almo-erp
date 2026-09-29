import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { lancarEntrada } from "./helpers/flows";

/**
 * Inventário (FASE 11).
 *
 * O ciclo completo: abrir a contagem, contar, encerrar (apurando a divergência)
 * e aplicar o ajuste que faz o saldo refletir a prateleira.
 */

const ITEM_NAME = "Caneta esferográfica azul";

test.describe.configure({ timeout: 120_000 });

test.describe("inventário", () => {
  test("contar, encerrar e ajustar divergência", async ({ page }) => {
    await loginAs(page, "almoxarife");

    // Garante saldo do item que será contado com divergência.
    await lancarEntrada(page, "ESC-0001", "20");

    await page.goto("/inventario/nova");
    await page.getByRole("button", { name: "Abrir inventário" }).click();
    await expect(page).toHaveURL(/\/inventario\/[^/?]+\?criado=1/, { timeout: 20_000 });

    // Conta apenas o item controlado; os demais ficam "não contados".
    await page.getByLabel("Buscar item na contagem").fill(ITEM_NAME);
    await page.getByLabel(`Quantidade contada de ${ITEM_NAME}`).fill("1");
    await page.getByRole("button", { name: "Salvar contagem" }).click();
    await expect(page.getByText(/1 de \d+ contados/)).toBeVisible({ timeout: 20_000 });

    // Encerrar apura as divergências, mas ainda não mexe no estoque.
    await page.getByRole("button", { name: "Encerrar contagem" }).click();
    await expect(page.getByText("Divergências encontradas")).toBeVisible({ timeout: 20_000 });

    // O ajuste exige justificativa e gera o documento de inventário.
    await page
      .getByLabel("Justificativa da divergência")
      .fill("Divergência apurada na contagem de inventário E2E");
    await page.getByRole("button", { name: "Aplicar ajuste no estoque" }).click();

    await expect(page).toHaveURL(/\/inventario\/[^/?]+\?ajustado=1/, { timeout: 20_000 });
    await expect(page.getByText("Ajuste aplicado", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });
});
