import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3001);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Em CI, um retry só: o teto de 5 minutos não comporta duas reexecuções.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

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
    // Em CI usamos build + start (servidor de produção): muito mais rápido que
    // o `next dev`, que compila cada rota sob demanda.
    command: process.env.E2E_WEB_SERVER_COMMAND ?? "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
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
