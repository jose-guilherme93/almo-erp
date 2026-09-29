import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { idFromUrl, lancarEntrada, openAs, pickItem } from "./helpers/flows";

/**
 * Estoque e transferências (FASES 06 e 07).
 *
 * Cobre o ledger visto pelo usuário: entrada gera saldo, ajuste exige
 * justificativa e a transferência baixa na origem e credita no destino.
 */

test.describe.configure({ timeout: 120_000 });

test.describe("estoque", () => {
  test("entrada gera saldo e documento lançado", async ({ page }) => {
    await loginAs(page, "almoxarife");
    await lancarEntrada(page, "EPI-0001", "25");

    // O documento fica imutável assim que é lançado.
    await expect(page.getByText("Lançado", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Capacete de segurança classe B").first()).toBeVisible();

    await page.goto("/estoque/saldos");
    await expect(page.getByText("Capacete de segurança classe B").first()).toBeVisible();
  });

  test("ajuste exige justificativa antes de mexer no saldo", async ({ page }) => {
    await loginAs(page, "almoxarife");

    // Garante que existe saldo para o ajuste reduzir.
    await lancarEntrada(page, "LMP-0002", "10");

    await page.goto("/estoque/ajustes/novo");
    await pickItem(page, "LMP-0002");
    await page.getByLabel(/Quantidade \(/).fill("-1");
    await page.getByRole("button", { name: "Lançar ajuste" }).click();

    await expect(page.getByText(/A justificativa do ajuste é obrigatória/).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel(/Justificativa/).fill("Quebra identificada na contagem física");
    await page.getByRole("button", { name: "Lançar ajuste" }).click();

    await expect(page).toHaveURL(/\/estoque\/movimentacoes\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByText("Ajuste", { exact: true }).first()).toBeVisible();
  });
});

test.describe("transferências", () => {
  test("envia da origem e recebe no destino", async ({ browser }) => {
    const almoxarife = await openAs(browser, "almoxarife");
    await lancarEntrada(almoxarife, "LMP-0001", "30");

    await almoxarife.goto("/transferencias/nova");
    await almoxarife.locator("#destination").click();
    await almoxarife
      .getByRole("option", { name: /FIL-RJ/ })
      .first()
      .click();
    await pickItem(almoxarife, "LMP-0001");
    await almoxarife.getByLabel(/Quantidade \(/).fill("5");
    await almoxarife.getByRole("button", { name: "Criar transferência" }).click();

    await expect(almoxarife).toHaveURL(/\/transferencias\/[^/?]+\?criada=1/, { timeout: 20_000 });
    const transferId = idFromUrl(almoxarife.url(), "transferencias");

    // Enviar baixa o saldo da origem.
    await almoxarife.getByRole("button", { name: "Enviar (baixa na origem)" }).click();
    await expect(almoxarife.getByText("Enviada", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    // A matriz responde pelo destino (nenhum usuário de demonstração está no RJ).
    const matriz = await openAs(browser, "superAdmin");
    await matriz.goto(`/transferencias/${transferId}`);
    await matriz.getByRole("button", { name: "Receber material" }).click();
    await matriz.getByRole("button", { name: "Confirmar recebimento" }).click();

    await expect(matriz.getByText("Recebida", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
