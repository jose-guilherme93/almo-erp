import { expect, test } from "@playwright/test";

import { openAs } from "./helpers/flows";

/**
 * Chamado de TI de ponta a ponta.
 *
 * Prova o roteamento por setor: um chamado de TI aberto na unidade chega para
 * o técnico de TI **daquela** unidade (não para o almoxarifado), ele enxerga o
 * chamado roteado ao seu setor antes de qualquer atribuição e a home dele é a
 * fila de chamados.
 */

// Troca de usuário no meio do fluxo: o default de 30s é apertado.
test.describe.configure({ timeout: 120_000 });

// E-mail do técnico criado pelo seed (`prisma/seed.ts`), no setor de TI.
const TI_EMAIL = "ti@exemplo.com.br";

test.describe("chamado de TI", () => {
  test("roteia para o técnico de TI da unidade e ele o enxerga", async ({ browser }) => {
    const suffix = Date.now().toString(36);
    const title = `Notebook sem rede ${suffix}`;

    // 1. O solicitante abre um chamado de TI na própria unidade.
    const solicitante = await openAs(browser, "solicitante");
    await solicitante.goto("/reparos/novo");

    await solicitante.getByLabel("Tipo de problema").click();
    await solicitante.getByRole("option", { name: "Informática e redes" }).click();
    await solicitante.getByLabel("Resuma o problema").fill(title);
    await solicitante.getByLabel("Onde exatamente?").fill("Recepção");
    await solicitante
      .getByLabel("Descreva o problema")
      .fill("O notebook da recepção parou de acessar a rede interna desde a manhã.");
    await solicitante.getByRole("button", { name: "Abrir chamado" }).click();

    await expect(solicitante).toHaveURL(/\/reparos\/[^/?]+\?criado=1/, { timeout: 20_000 });

    // O chamado nasce roteado para a TI.
    await expect(solicitante.getByText(/Atende:\s*Tecnologia da Informação/)).toBeVisible();

    const headerText =
      (await solicitante
        .getByText(/REP-\d{4}-\d{6}/)
        .first()
        .textContent()) ?? "";
    const number = headerText.match(/REP-\d{4}-\d{6}/)?.[0] ?? "";
    expect(number).toMatch(/^REP-\d{4}-\d{6}$/);

    // 2. O técnico de TI entra: a home dele é a fila de chamados.
    const tecnico = await openAs(browser, TI_EMAIL);
    await expect(tecnico).toHaveURL(/\/reparos$/, { timeout: 20_000 });

    // 3. O chamado aparece na fila (abertos por padrão) e abre no detalhe.
    await tecnico.goto(`/reparos?busca=${suffix}`);

    const rowHref = await tecnico
      .getByRole("link", { name: new RegExp(suffix, "i") })
      .first()
      .getAttribute("href");

    expect(rowHref).toBeTruthy();
    await tecnico.goto(rowHref ?? "/reparos");

    await expect(tecnico.getByRole("button", { name: "Assumir chamado" })).toBeVisible();

    // 4. A notificação de abertura chegou na caixa dele.
    await tecnico.goto("/notificacoes");
    await expect(tecnico.getByText(number ?? "", { exact: false }).first()).toBeVisible();

    await solicitante.context().close();
    await tecnico.context().close();
  });
});
