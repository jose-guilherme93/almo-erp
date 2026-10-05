/**
 * Versionamento automático por Conventional Commits.
 *
 * Decisão **pura**: recebe a lista de mensagens de commit e a versão atual,
 * devolve a próxima versão e o motivo. Sem git, sem rede, sem I/O — por isso
 * dá para testar a regra inteira na velocidade de um unitário, que é onde mora
 * o risco real desta feature (uma regra de bump errada publica versão errada).
 *
 * A versão é sempre derivada do commit, nunca digitada à mão. Quem só precisa
 * escrever `feat(estoque): ...` e mergear.
 */

export type SemVer = {
  major: number;
  minor: number;
  patch: number;
};

export type BumpKind = "major" | "minor" | "patch" | "none";

export type BumpDecision = {
  kind: BumpKind;
  next: SemVer;
  /** Commits que motivaram o bump — entra no corpo da tag. */
  reasons: string[];
  /** `true` quando não há commit que justifique versão nova. */
  skip: boolean;
};

/** Ordem de severidade: o maior vence. */
const SEVERITY: Record<Exclude<BumpKind, "none">, number> = {
  patch: 1,
  minor: 2,
  major: 3,
};

/** Tipos que valem uma versão nova, e o tamanho do salto. */
const BUMP_BY_TYPE: Record<string, Exclude<BumpKind, "none">> = {
  feat: "minor",
  fix: "patch",
  perf: "patch",
  refactor: "patch",
  revert: "patch",
};

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Linha de commit Conventional Commits: `tipo(escopo)!: assunto`. */
const CONVENTIONAL_PATTERN = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

/** `BREAKING CHANGE:` no corpo, na forma que o Conventional Commits define. */
const BREAKING_FOOTER_PATTERN = /^BREAKING[ -]CHANGE:/m;

export function parseSemVer(value: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(value.trim());

  if (!match) return null;

  const [, major, minor, patch] = match;

  return {
    major: Number(major ?? 0),
    minor: Number(minor ?? 0),
    patch: Number(patch ?? 0),
  };
}

export function formatSemVer(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Aplica o salto. `major` volta o minor e o patch a zero, como manda o SemVer. */
export function applyBump(current: SemVer, kind: Exclude<BumpKind, "none">): SemVer {
  switch (kind) {
    case "major":
      return { major: current.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: current.major, minor: current.minor + 1, patch: 0 };
    case "patch":
      return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  }
}

/**
 * Lê uma mensagem de commit e devolve o tipo de bump que ela exige.
 *
 * Merge não conta: é container de operação, não mudança de produto — sem isso
 * todo merge publicaria versão.
 */
export function bumpFromCommit(message: string): BumpKind {
  const [firstLine = ""] = message.split("\n");
  const subject = firstLine.trim();

  if (/^Merge\b/i.test(subject)) return "none";

  const match = CONVENTIONAL_PATTERN.exec(subject);

  if (!match) return "none";

  // `feat!:` ou `refactor!:` é quebra de contrato, independente do tipo.
  if (match[3] === "!" || BREAKING_FOOTER_PATTERN.test(message)) return "major";

  return BUMP_BY_TYPE[match[1] ?? ""] ?? "none";
}

/**
 * Decide a próxima versão a partir dos commits desde a última tag.
 *
 * Commits que não seguem Conventional Commits são ignorados em silêncio: um
 * repositório é só de `main`, e falhar o release por causa de um commit
 * malformado seria pior do que publicar uma versão a menos.
 */
export function decideBump(current: string, commitMessages: string[]): BumpDecision {
  const parsed = parseSemVer(current);

  if (!parsed) {
    throw new Error(`Versão "${current}" não é SemVer (esperado X.Y.Z).`);
  }

  // `null` = ainda nenhum commit que justifique versão. Precisa ser `null` e não
  // `"none"`: comparar a severidade de "none" com a de um patch compararia número
  // com `undefined` e o primeiro `fix` da lista seria sempre ignorado.
  let kind: Exclude<BumpKind, "none"> | null = null;
  const reasons: string[] = [];

  for (const message of commitMessages) {
    const [firstLine = ""] = message.split("\n");
    const subject = firstLine.trim();

    if (/^Merge\b/i.test(subject)) continue;

    const match = CONVENTIONAL_PATTERN.exec(subject);
    const breaking = match?.[3] === "!" || BREAKING_FOOTER_PATTERN.test(message);

    if (!match && !breaking) continue;

    const type = match?.[1] ?? "";
    const candidate: BumpKind = breaking ? "major" : (BUMP_BY_TYPE[type] ?? "none");

    if (candidate === "none") continue;

    if (kind === null || SEVERITY[candidate] > SEVERITY[kind]) {
      kind = candidate;
    }

    reasons.push(breaking ? `${subject} (BREAKING)` : subject);
  }

  if (kind === null) {
    return { kind: "none", next: parsed, reasons, skip: true };
  }

  return { kind, next: applyBump(parsed, kind), reasons, skip: false };
}

/** Linha de changelog de uma tag, a partir dos commits que motivaram o bump. */
export function changelogFor(version: string, decision: BumpDecision): string {
  const lines = [`## ${version}`, ""];

  if (decision.reasons.length === 0) {
    lines.push("Sem mudanças de código.");
  } else {
    lines.push(...decision.reasons.map((reason) => `- ${reason}`));
  }

  return lines.join("\n");
}
