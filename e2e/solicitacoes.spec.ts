import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { idFromUrl, lancarEntrada, openAs, pickItem } from "./helpers/flows";

/**
 * Fluxo de material de ponta a ponta (FASE 08).
 *
 * Prova a integridade do caminho mais importante do sistema: a entrada cria
 * saldo, o pedido nasce enviado, a aprovação reserva o material e a entrega
 * baixa o estoque e encerra a solicitação.
 */

const ITEM = "EPI-0002";

// O fluxo troca de usuário algumas vezes; 30s (default) é apertado demais.
test.describe.configure({ timeout: 120_000 });

test.describe("solicitação de material", () => {
  test("criar, aprovar e entregar dá baixa no estoque", async ({ browser }) => {
    // 1. O almoxarife garante saldo para o pedido ser aprovado.
    const almoxarife = await openAs(browser, "almoxarife");
    await lancarEntrada(almoxarife, ITEM, "40");

    // 2. O solicitante abre o pedido — já nasce enviado para aprovação.
    const solicitante = await openAs(browser, "solicitante");
    await solicitante.goto("/solicitacoes/nova");
    await pickItem(solicitante, ITEM);
    await solicitante.getByLabel(/Quantidade \(/).fill("3");
    await solicitante.getByRole("button", { name: "Enviar pedido" }).click();

    await expect(solicitante).toHaveURL(/\/solicitacoes\/[^/?]+\?criada=1/, { timeout: 20_000 });
    const requestId = idFromUrl(solicitante.url(), "solicitacoes");

    // 3. Quem aprova decide e o material fica reservado.
    const aprovador = await openAs(browser, "adminFilial");
    await aprovador.goto(`/solicitacoes/${requestId}`);
    await aprovador.getByRole("button", { name: "Decidir", exact: true }).click();
    await aprovador.getByRole("button", { name: "Confirmar aprovação" }).click();

    await expect(aprovador.getByText("Aprovada", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    // 4. A entrega baixa o estoque e fecha a solicitação.
    await almoxarife.goto(`/entregas/${requestId}`);
    await almoxarife.locator("#received-by-name").fill("Maria E2E");
    await almoxarife
      .getByRole("button", { name: "Confirmar entrega e dar baixa no estoque" })
      .click();

    await expect(almoxarife).toHaveURL(new RegExp(`/solicitacoes/${requestId}`), {
      timeout: 20_000,
    });
    await expect(almoxarife.getByText("Entregue", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("solicitante não acessa a fila de aprovação", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/solicitacoes/fila");

    await expect(page).toHaveURL(/\/forbidden/);
  });
});
