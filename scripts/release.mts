/**
 * CLI de release: decide a versão, grava no `package.json`, commita e cria a tag.
 *
 * Toda a decisão mora em `src/lib/release.ts` (pura e testada). Este script só
 * fala com o git e o disco — para o erro de regra aparecer no unitário, não
 * depois da tag publicada.
 *
 * Uso (o CI chama; rodar à mão é para depurar):
 *   node --experimental-strip-types scripts/release.mts
 *
 * Variáveis de ambiente:
 *   VERSION=1.2.0  escreve a tag `v1.2.0` em vez de derivar dos commits.
 *   DRY_RUN=1       só imprime a decisão, não commita nem cria tag.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { changelogFor, decideBump, formatSemVer } from "../src/lib/release.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON = join(ROOT, "package.json");
const DRY_RUN = process.env["DRY_RUN"] === "1";

/** Identidade do commit de release: o Actions não configura author no clone. */
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "github-actions[bot]@users.noreply.github.com";

/** Script de CLI: a saída no terminal é a interface com o operador. */
function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function readVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));

  if (typeof raw !== "object" || raw === null || !("version" in raw)) {
    throw new Error("package.json sem campo `version`.");
  }

  const version = (raw as { version: unknown }).version;

  if (typeof version !== "string") throw new Error("`version` do package.json não é string.");

  return version;
}

/**
 * Commits da última tag até HEAD, cada um já sem espaços nas pontas.
 *
 * O `%B` do git termina com quebra de linha e o separador `\0` cai **depois**
 * dela, então a mensagem seguinte chega com um `\n` na frente. Sem o `trim`, o
 * assunto vira `"\nfeat(…): …"` e o Conventional Commits deixa de casar — o
 * release passaria a pular toda versão em silêncio, que é o pior jeito de
 * falhar.
 */
function commitsSinceLastTag(): string[] {
  const lastTag = git(["describe", "--tags", "--abbrev=0"]);
  const range = lastTag ? [`${lastTag}..HEAD`] : [];

  return git(["log", ...range, "--format=%B%x00"])
    .split("\0")
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
}

function writeVersion(version: string): void {
  const raw = readFileSync(PACKAGE_JSON, "utf8");
  const updated = raw.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);

  writeFileSync(PACKAGE_JSON, updated);
}

function tagExists(tag: string): boolean {
  return git(["tag", "--list", tag]).length > 0;
}

function main(): void {
  const current = readVersion();
  const override = process.env["VERSION"];
  const messages = commitsSinceLastTag();

  const decision = decideBump(current, messages);

  // `VERSION=` tem precedência: é o escape para um hotfix pontual e para
  // reexecutar um release que falhou no meio.
  const version = override ?? (decision.skip ? current : formatSemVer(decision.next));

  if (!override && decision.skip) {
    console.log(`Nenhum commit desde a última versão exige bump (atual ${current}). Sem tag nova.`);
    console.log(`Commits analisados: ${messages.length}`);
    return;
  }

  const tag = `v${version}`;
  const changelog = changelogFor(tag, decision);

  console.log(`Versão atual:  ${current}`);
  console.log(`Próxima versão: ${version} (${override ? "definida por VERSION" : decision.kind})`);
  console.log(`Tag:            ${tag}`);
  console.log("");
  console.log(changelog);

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1: nada foi escrito, commitado ou tagueado.");
    return;
  }

  if (tagExists(tag)) {
    console.log(`\nTag ${tag} já existe. Nada a fazer.`);
    return;
  }

  writeVersion(version);
  console.log(`\npackage.json → ${version}`);

  // O bot do GitHub não tem identidade no clone: sem isto o commit de release
  // morre com "Author identity unknown" — depois do `package.json` já ter sido
  // alterado, o que deixa o repositório inconsistente.
  git(["config", "user.name", BOT_NAME]);
  git(["config", "user.email", BOT_EMAIL]);

  git(["add", "package.json"]);

  // Commit próprio de release: a tag aponta para ele, então o histórico fica
  // auditável e `git show v1.2.0` mostra exatamente o que foi publicado.
  git(["commit", "-m", `chore(release): ${version}\n\n${changelog}`]);
  console.log(`Commit de release criado.`);

  git(["tag", "-a", tag, "-m", `Release ${tag}\n\n${changelog}`]);
  console.log(`Tag ${tag} criada localmente.`);

  const pushTag = process.env["PUSH"] === "1";

  if (pushTag) {
    git(["push", "origin", `HEAD:${process.env["PUSH_BRANCH"] ?? "main"}`]);
    git(["push", "origin", tag]);
    console.log(`Tag ${tag} publicada.`);
  } else {
    console.log(`\nPUSH!=1: commit e tag ficam locais. Use PUSH=1 para publicar.`);
  }
}

try {
  main();
} catch (error) {
  // `console.error` é liberado pela regra do ESLint.
  console.error("Falha no release:", error instanceof Error ? error.message : error);
  process.exit(1);
}
