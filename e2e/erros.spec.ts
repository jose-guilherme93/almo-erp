import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers/auth";

/**
 * Tela de erros do servidor (FASE 20).
 *
 * O que este teste prova, e o que não prova:
 *
 * - **Prova:** a tela abre para quem pode, nega para quem não pode, e diz
 *   "nenhum erro" quando não há nada — os três caminhos que quebram de verdade
 *   quando a rota ou o guard estão errados.
 * - **Não prova:** a captura de erro de render, a deduplicação, os filtros e o
 *   marcar-como-resolvido. Provocar um 500 determinístico exigiria semear dado no
 *   banco, e os specs deste repositório não tocam no Prisma (o client gerado não
 *   carrega no runtime do Playwright). Tudo isso está coberto em
 *   `src/server/services/error-log.test.ts`, e a captura ponta a ponta foi
 *   verificada contra o servidor de desenvolvimento com um erro proposital.
 */

test.describe("erros do servidor", () => {
  test("a matriz abre a tela e vê o estado vazio", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/erros");

    await expect(page.getByRole("heading", { name: "Erros" })).toBeVisible();
    await expect(page.getByText("Nenhum erro registrado")).toBeVisible();
  });

  test("os filtros estão lá e rotulados", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/admin/erros");

    // Sem esses filtros, quem recebe o alerta do sino não tem como chegar ao erro.
    await expect(
      page.getByRole("searchbox", { name: /Buscar por mensagem ou referência/ }),
    ).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Rota" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Situação" })).toBeVisible();
  });

  test("o item de menu aponta para a tela", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/meu");

    await expect(page.getByRole("link", { name: "Erros" }).first()).toBeVisible();
    await page.getByRole("link", { name: "Erros" }).first().click();

    await expect(page).toHaveURL(/\/admin\/erros/);
  });

  test("quem não administra não acessa", async ({ page }) => {
    await loginAs(page, "almoxarife");
    await page.goto("/admin/erros");

    await expect(page).toHaveURL(/\/forbidden|\/not-found/);
  });

  test("quem não administra tampouco vê o link", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/meu");

    await expect(page.getByRole("link", { name: "Erros" })).toHaveCount(0);
  });
});
