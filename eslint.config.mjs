import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Limites de import do AGENTS.md §4, aplicados por pasta. */
const BOUNDARIES = [
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/app/*", "@/components/*"],
              message:
                "src/lib é a base: não pode depender de server/, app/ nem components/ (AGENTS.md §4).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/components/*"],
              message: "src/server não pode depender da camada de UI (AGENTS.md §4).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/services/*"],
              message:
                "Componente não importa serviço. Chame uma Server Action em @/server/actions (AGENTS.md §4).",
            },
            {
              group: ["@/generated/prisma/*"],
              message:
                "Componente (inclusive client) nunca importa o Prisma Client (AGENTS.md §11).",
            },
          ],
        },
      ],
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...BOUNDARIES,
  {
    rules: {
      // Tipagem estrita: `any` explícito é sempre erro.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-else-return": "error",
    },
  },
  {
    files: ["prisma/seed.ts", "prisma/**/*.ts"],
    rules: {
      // Script de CLI: a saída no terminal é a interface com o operador.
      "no-console": "off",
    },
  },
  {
    files: ["src/lib/logger.ts"],
    rules: {
      // O logger é o único lugar autorizado a falar com o console.
      "no-console": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
