import { chromium, type FullConfig } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { APP_ROUTES } from "./helpers/routes";

const FALLBACK_BASE_URL = "http://localhost:3001";

/**
 * Compila as telas antes do primeiro teste.
 *
 * `next dev` compila cada rota **na primeira visita**. Sem este passo, a
 * compilação acontece dentro do teste e disputa o `expect.timeout` de cada um.
 * Aquecer é otimização — e otimização **não pode derrubar nada**. Ver abaixo.
 *
 * ## Por que o `baseURL` vem do config, e não do ar
 *
 * `globalSetup` roda **fora** do contexto de teste: ele não herda o `use` da
 * configuração. `browser.newPage()` sem `baseURL` não resolve URL relativa, e
 * `page.goto("/login")` lança `Cannot navigate to invalid URL`. Foi exatamente
 * esse o erro que fez as primeiras execuções no Actions gastarem mais de vinte
 * minutos sem rodar **um único teste**: o warm-up morria na primeira linha e
 * levava a suíte inteira junto.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  try {
    await warmRoutes(resolveBaseUrl(config));
  } catch (error) {
    // Não-fatal, porém **alto**. Aquecer é otimização: falhar nela não pode
    // impedir os testes de rodar. Mas silêncio aqui é pior do que falha — foi um
    // warm-up quebrado, sem ninguém saber, que consumiu três execuções no CI
    // enquanto eu atribuía a lentidão aos testes.
    console.warn(
      "[global-setup] warm-up não completou; os testes rodam mesmo assim:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Tudo que pode falhar fica aqui dentro, longe da suíte. */
async function warmRoutes(baseURL: string): Promise<void> {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ baseURL });

    await loginAs(page, "superAdmin");

    for (const route of APP_ROUTES) {
      try {
        // `domcontentloaded` e não `networkidle`: o que importa é a resposta ter
        // chegado, e `networkidle` esperaria o dev server ficar ocioso — que é
        // justamente o que ele não fica durante a compilação.
        await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      } catch {
        // Rota aquecida mesmo assim (id de unidade inexistente, por exemplo):
        // o objetivo é compilar, não verificar.
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * O `baseURL` resolvido da configuração.
 *
 * Mesmo valor que os testes usam — se um dia mudar a porta ou o host, muda aqui
 * junto, sem uma segunda fonte para divergir.
 */
function resolveBaseUrl(config: FullConfig): string {
  return (
    config.projects[0]?.use?.baseURL ??
    process.env["E2E_BASE_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    FALLBACK_BASE_URL
  );
}
