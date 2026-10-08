import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3001);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Um retry só. No runner, um primeiro acesso perdido costuma ser a rota ainda
  // compilando, e o segundo passe é o que separa "flake de infra" de defeito.
  retries: process.env.CI ? 1 : 0,

  // Compila todas as telas antes do primeiro teste — ver `e2e/global-setup.ts`.
  // Sem isso a compilação sob demanda acontece dentro do timeout de cada teste.
  globalSetup: "./e2e/global-setup.ts",

  // Workers: o workflow mede com `nproc` e exporta `E2E_WORKERS`, para não
  // depender de suposição sobre o tamanho do runner. Localmente é 1, porque o uso
  // local é depurar um spec de cada vez (§9.4).
  workers: Number(process.env["E2E_WORKERS"] ?? 1),
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],

  // O primeiro acesso a cada rota em `next dev` compila o segmento sob demanda;
  // 15s evita flakiness sem afrouxar a verificação.
  expect: {
    timeout: 15_000,
  },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera"],
        // Câmera sintética do Chromium e permissão concedida sem diálogo. É o que
        // permite testar o leitor de código de barras de verdade, em vez de só
        // clicar no botão e torcer.
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        permissions: ["camera"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
      },
    },
  ],

  webServer: {
    // Sempre `next dev`, no CI e local. O comentário que existia aqui prometia
    // `build && start` no CI: isso nunca esteve ligado, e é proibido de qualquer
    // forma — o bypass de autenticação de teste só existe fora de produção
    // (`src/lib/env.ts`), e `next start` roda com `NODE_ENV=production`.
    command: process.env.E2E_WEB_SERVER_COMMAND ?? "pnpm dev",

    // O padrão do Playwright já é `SIGKILL` no grupo de processos, e **não estava
    // bastando**: depois de a suíte terminar (4,5 min, 103 verdes) o passo ficava
    // 19 min em silêncio e só acabava no teto do job. O log do runner mostrou
    // `Terminate orphan process: (next-server)` no encerramento — o servidor
    // sobreviveu ao Playwright. Declarar o encerramento deixa sinal e prazo
    // explícitos, com `SIGKILL` logo atrás para o que não morrer.
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 5_000,
    },
    url: baseURL,
    // Quem sobe o servidor é o workflow (`e2e.yml`), e ele também é quem mata.
    // Aqui só se reaproveita o que já está no ar — assinar o encerramento de um
    // processo que não é nosso foi o que deixou o job 19 min pendurado.
    reuseExistingServer: Boolean(process.env["E2E_REUSE_SERVER"]) || !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // Liga o provider de credenciais usado pelos testes. O `src/lib/env.ts`
      // recusa esta combinação em produção.
      E2E_AUTH_BYPASS: "true",
    },
  },
});
