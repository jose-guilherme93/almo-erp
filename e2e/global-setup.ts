import { chromium, type APIRequestContext, type FullConfig } from "@playwright/test";

import { loginAs } from "./helpers/auth";
import { APP_ROUTES } from "./helpers/routes";

const FALLBACK_BASE_URL = "http://localhost:3001";

/** Quantas rotas compilar ao mesmo tempo. Casa com as vCPU do runner. */
const WARM_CONCURRENCY = 4;

/**
 * Compila as telas antes do primeiro teste.
 *
 * `next dev` compila cada rota **na primeira visita**. Sem este passo, a
 * compilação acontece dentro do teste e disputa o `expect.timeout` de cada um.
 *
 * ## Duas versões anteriores, e o que cada uma ensinou
 *
 * A primeira **derrubou a suíte**: `globalSetup` roda fora do contexto de teste e
 * não herda o `use` da configuração, então `page.goto("/login")` com URL relativa
 * lançava `Cannot navigate to invalid URL` — e o login estava fora do `try`. Zero
 * testes rodaram, em três execuções.
 *
 * A segunda funcionou e **virou o gargalo**: sequencial e renderizando cada tela
 * no Chromium. Medido no runner: os 103 testes somam ~33 min de trabalho (≈8-10
 * min com 4 workers), mas o passo levou 24,5 min — a diferença era este warm-up
 * compilando 32 rotas em série, ~25 s cada.
 *
 * Agora ele faz o mínimo: **requisição HTTP, sem renderizar**, algumas em
 * paralelo. O que compila a rota é a requisição; abrir a página e executar o
 * JavaScript dela não compila nada a mais.
 *
 * ## Não é fatal, mas não é silencioso
 *
 * Aquecer é otimização. Falhar nela não pode impedir o teste de rodar — mas o
 * silêncio foi o que tornou o primeiro diagnóstico impossível, então o tempo
 * gasto e qualquer falha vão para o log.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = resolveBaseUrl(config);
  const startedAt = Date.now();

  try {
    await warmRoutes(baseURL);

    console.log(`[global-setup] ${APP_ROUTES.length} telas aquecidas em ${seconds(startedAt)}`);
  } catch (error) {
    console.warn(
      `[global-setup] warm-up não completou em ${seconds(startedAt)}; ` +
        `os testes rodam mesmo assim:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Tudo que pode falhar fica aqui dentro, longe da suíte. */
async function warmRoutes(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });

  try {
    // O login acontece de verdade, na interface: é o mesmo caminho dos testes, e
    // é ele que garante a sessão que o resto do warm-up reaproveita.
    const page = await context.newPage();

    await loginAs(page, "superAdmin");
    await page.close();

    await eachLimit(APP_ROUTES.length, WARM_CONCURRENCY, async (index) => {
      const route = APP_ROUTES[index];

      if (!route) return;

      // URL absoluta de propósito: não depender de o `baseURL` do contexto ser
      // herdado pelo `APIRequestContext` é uma dúvida que já custou três runs.
      await warmOne(context.request, new URL(route.path, baseURL).toString());
    });
  } finally {
    await browser.close();
  }
}

/** Uma rota. Falha de uma não derruba o aquecimento das outras. */
async function warmOne(request: APIRequestContext, url: string): Promise<void> {
  try {
    await request.get(url, { timeout: 60_000 });
  } catch {
    // Rota aquecida mesmo assim (id de unidade inexistente, por exemplo):
    // o objetivo é compilar, não verificar.
  }
}

/**
 * Executa `task` para `0..total` com no máximo `limit` em andamento.
 *
 * Sem isso o warm-up era serial — um `forEach` com `await` dentro, que foi
 * exatamente o que o transformou no gargalo.
 */
async function eachLimit(
  total: number,
  limit: number,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < total) {
      const index = next++;
      await task(index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
}

function seconds(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1_000).toFixed(1)}s`;
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
