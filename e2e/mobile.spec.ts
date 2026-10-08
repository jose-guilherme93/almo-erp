import { expect, test, type Page } from "@playwright/test";

import { loginAs, TEST_USERS } from "./helpers/auth";
import { APP_ROUTES } from "./helpers/routes";

/**
 * Espera a URL parar de mudar.
 *
 * Algumas rotas terminam num `redirect()` do servidor que o Next aplica no
 * cliente **depois** do primeiro paint (ex.: `/dashboard/unidade/x` →
 * `/forbidden`, porque a filial não está no escopo). Medir nesse intervalo
 * derruba o `page.evaluate` com "Execution context was destroyed, most likely
 * because of a navigation" — que foi a falha real do runner, não a do layout.
 *
 * A espera é por **condição** (a URL ficou estável), não `networkidle`: só o
 * redirect pendente interessa, e ele se resolve em poucas centenas de ms.
 */
async function waitForUrlToSettle(page: Page): Promise<void> {
  let previous = page.url();
  let stable = 0;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(100);
    const current = page.url();

    stable = current === previous ? stable + 1 : 0;
    previous = current;

    // 300 ms estável: se havia redirect pendente, ele já apareceu.
    if (stable >= 3) return;
  }
}

/**
 * Responsividade para uso no celular.
 *
 * O sistema é instalado como PWA no celular do colaborador — o almoxarife usa
 * no balcão. O critério objetivo de "não quebrou" é: **nenhuma tela pode
 * gerar rolagem horizontal** na largura de um celular comum.
 *
 * Rolagem horizontal é o sintoma clássico de tabela larga, grid fixo ou
 * elemento com largura maior que a viewport.
 */

const MOBILE = { width: 390, height: 844 };

test.use({ viewport: MOBILE });

test.describe("mobile 390px", () => {
  for (const screen of APP_ROUTES) {
    test(`${screen.label} (${screen.path}) não tem rolagem horizontal`, async ({ page }) => {
      await loginAs(page, screen.user);
      await page.goto(screen.path);

      // O redirect pendente (quando há) precisa terminar antes de medirmos, ou o
      // `page.evaluate` cai num contexto que a navegação já destruiu.
      await waitForUrlToSettle(page);

      // Espera **determinística**, não `networkidle`.
      //
      // `networkidle` significa "500 ms sem tráfego de rede". Num `next dev`, que
      // mantém HMR, streaming de RSC e o SDK de erro, isso é uma condição que pode
      // demorar ou simplesmente não chegar — e a medição acabava acontecendo num
      // ponto indeterminado do layout. Era essa a causa dos testes flaky que
      // apareciam em telas diferentes a cada execução: `stats.flaky` do relatório
      // apontava um teste ora aqui, ora ali, sem padrão.
      //
      // O que a medição precisa é o conteúdo principal montado e as fontes
      // carregadas (largura de texto depende delas). Duas animações de quadro
      // depois disso assentam o layout.
      await page.locator("main").first().waitFor({ state: "visible" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;

        // Procuramos o elemento que estoura, para o erro ser acionável.
        const culprits: string[] = [];

        for (const element of document.querySelectorAll<HTMLElement>("body *")) {
          const rect = element.getBoundingClientRect();

          if (rect.width === 0) continue;

          if (rect.right > root.clientWidth + 1) {
            const id = element.id ? `#${element.id}` : "";
            const cls =
              typeof element.className === "string" && element.className.length > 0
                ? `.${element.className.split(" ").slice(0, 2).join(".")}`
                : "";

            culprits.push(`${element.tagName.toLowerCase()}${id}${cls}`);
          }
        }

        return {
          hasHorizontalScroll: root.scrollWidth > root.clientWidth + 1,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          culprits: [...new Set(culprits)].slice(0, 5),
        };
      });

      expect(
        overflow.hasHorizontalScroll,
        `Rolagem horizontal: ${overflow.scrollWidth}px numa viewport de ${overflow.clientWidth}px. Elementos que estouram: ${overflow.culprits.join(", ")}`,
      ).toBe(false);
    });
  }
});

test.describe("navegação no celular", () => {
  test("o menu abre em gaveta e navega", async ({ page }) => {
    await loginAs(page, "solicitante");
    await page.goto("/meu");

    await page.getByRole("button", { name: "Abrir menu" }).click();

    // O menu é uma gaveta: os itens ficam visíveis sem empurrar o conteúdo.
    await expect(page.getByRole("link", { name: "Fazer um pedido" })).toBeVisible();

    await page.getByRole("link", { name: "Fazer um pedido" }).click();

    await expect(page).toHaveURL(/\/solicitar/);
  });

  test("a barra superior cabe na tela do celular", async ({ page }) => {
    await loginAs(page, "adminFilial");
    await page.goto("/meu");

    await expect(page.getByRole("button", { name: /Notificações/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
  });
});

test.describe("PWA", () => {
  test("o manifesto é servido sem exigir sessão", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");

    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: Array<{ sizes: string }>;
    };

    expect(manifest.name).toBe("almo-erp");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === "512x512")).toBe(true);
  });

  test("o service worker é servido na raiz", async ({ request }) => {
    const response = await request.get("/sw.js");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
  });

  test("o ícone está disponível em 192 e 512", async ({ request }) => {
    for (const size of [192, 512]) {
      const response = await request.get(`/icons/icon-${size}.png`);

      expect(response.status(), `ícone ${size}`).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
  });

  test("a página declara o manifesto e o modo tela cheia (iOS)", async ({ page }) => {
    await page.goto("/login");

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    // As duas: a padronizada (iOS 16.4+) e a legada (iOS anterior).
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      "content",
      "almo-erp",
    );
  });

  test("o cadastro de usuário existente serve de sanidade do login", async ({ page }) => {
    // Garante que o helper de login continua funcionando após as mudanças.
    await loginAs(page, TEST_USERS.solicitante);

    await expect(page).toHaveURL(/\/(solicitar|meu)/);
  });
});
