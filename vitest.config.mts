import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "e2e"],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // Os testes de integração dividem o mesmo banco: rodar arquivos em
    // paralelo faz um limpar o dado do outro. Sequencial é mais lento e
    // confiável.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**", "src/server/services/**"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "src/generated/**"],
      thresholds: {
        // Metas do AGENTS.md §9 e da FASE 13.
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
});
