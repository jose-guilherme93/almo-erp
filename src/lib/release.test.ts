/**
 * Regras de versionamento automático.
 *
 * O risco desta feature é uma regra de bump errada publicando versão errada, e
 * isso só aparece em produção. Por isso a decisão mora pura em `release.ts` e
 * é testada direto aqui — sem git, sem tag, sem rede.
 */

import { describe, expect, it } from "vitest";

import {
  applyBump,
  bumpFromCommit,
  changelogFor,
  decideBump,
  formatSemVer,
  parseSemVer,
} from "@/lib/release";

describe("parseSemVer", () => {
  it("lê uma versão válida", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("recusa o que não é SemVer", () => {
    expect(parseSemVer("1.2")).toBeNull();
    expect(parseSemVer("v1.2.3")).toBeNull();
    expect(parseSemVer("banana")).toBeNull();
  });
});

describe("applyBump", () => {
  it("major zera minor e patch", () => {
    expect(applyBump({ major: 1, minor: 4, patch: 7 }, "major")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    });
  });

  it("minor zera patch", () => {
    expect(applyBump({ major: 1, minor: 4, patch: 7 }, "minor")).toEqual({
      major: 1,
      minor: 5,
      patch: 0,
    });
  });

  it("patch soma um", () => {
    expect(applyBump({ major: 1, minor: 4, patch: 7 }, "patch")).toEqual({
      major: 1,
      minor: 4,
      patch: 8,
    });
  });
});

describe("bumpFromCommit", () => {
  it("feat é minor", () => {
    expect(bumpFromCommit("feat(estoque): entrada pela doca")).toBe("minor");
  });

  it("fix e perf são patch", () => {
    expect(bumpFromCommit("fix(login): senha errada")).toBe("patch");
    expect(bumpFromCommit("perf(lista): cache de categoria")).toBe("patch");
  });

  it("refactor e revert são patch", () => {
    expect(bumpFromCommit("refactor: extrai serviço")).toBe("patch");
    expect(bumpFromCommit('revert: "feat(x): coisa"')).toBe("patch");
  });

  it("bang no tipo é major, qualquer que seja o tipo", () => {
    expect(bumpFromCommit("feat(api)!: remove campo")).toBe("major");
    expect(bumpFromCommit("refactor(db)!: muda schema")).toBe("major");
  });

  it("BREAKING CHANGE no corpo é major mesmo em fix", () => {
    const message = ["fix(estoque): saldo negativo", "", "BREAKING CHANGE: não é mais aceito"].join(
      "\n",
    );

    expect(bumpFromCommit(message)).toBe("major");
  });

  it("docs, chore e test não publicam versão", () => {
    expect(bumpFromCommit("docs: ajusta readme")).toBe("none");
    expect(bumpFromCommit("chore(deps): bump do next")).toBe("none");
    expect(bumpFromCommit("test: cobre a doca")).toBe("none");
  });

  it("merge não publica versão", () => {
    expect(bumpFromCommit("Merge da FASE 19 para a main")).toBe("none");
    expect(bumpFromCommit("Merge branch 'main' into develop")).toBe("none");
  });

  it("assunto sem Conventional Commits é ignorado", () => {
    expect(bumpFromCommit("ajustei uma coisa")).toBe("none");
    expect(bumpFromCommit("")).toBe("none");
  });
});

describe("decideBump", () => {
  it("sobe minor com um feat entre fixes", () => {
    const decision = decideBump("1.0.1", [
      "fix(login): corrige erro",
      "feat(doca): entrada por código de barras",
      "fix(ui): alinha botão",
    ]);

    expect(decision.kind).toBe("minor");
    expect(decision.skip).toBe(false);
    expect(formatSemVer(decision.next)).toBe("1.1.0");
  });

  it("o maior bump vence, qualquer que seja o tipo", () => {
    const decision = decideBump("1.0.1", [
      "feat(a): primeira coisa",
      "feat(b)!: quebra o contrato",
      "fix(c): terceira coisa",
    ]);

    expect(decision.kind).toBe("major");
    expect(formatSemVer(decision.next)).toBe("2.0.0");
  });

  // A propriedade que impede o workflow de gerar versão em loop.
  //
  // A rodada 1 vê o `feat` e publica a tag `v1.1.0` no commit de release. A
  // rodada 2 lê os commits *depois* dessa tag — que são só `chore(release)` e
  // `docs`. Se qualquer um deles bumpsse, cada push geraria outra tag, para
  // sempre.
  it("o commit de release não cascateia em nova versão", () => {
    expect(decideBump("1.1.0", ["chore(release): 1.1.0"]).skip).toBe(true);
    expect(decideBump("1.1.0", ["chore(release): 1.1.0", "docs: ajusta o readme"]).skip).toBe(true);
  });

  it("publica de novo quando entra trabalho novo depois do release", () => {
    const decision = decideBump("1.1.0", [
      "chore(release): 1.1.0",
      "fix(login): corrige o erro de senha",
    ]);

    expect(decision.kind).toBe("patch");
    expect(formatSemVer(decision.next)).toBe("1.1.1");
  });

  it("não publica versão sem commit que justifique", () => {
    const decision = decideBump("1.0.1", [
      "Merge da FASE 19 para a main",
      "docs: corrige o readme",
      "chore: ajusta dependência",
    ]);

    expect(decision.skip).toBe(true);
    expect(formatSemVer(decision.next)).toBe("1.0.1");
  });

  it("só merge não publica versão", () => {
    expect(decideBump("1.0.1", ["Merge origin/main into develop"]).skip).toBe(true);
  });

  it("lista de commits vazia não publica versão", () => {
    expect(decideBump("1.0.1", []).skip).toBe(true);
  });

  it("acumula patch a partir de qualquer número", () => {
    expect(formatSemVer(decideBump("0.9.9", ["fix(a): um"]).next)).toBe("0.9.10");
  });

  it("levanta em versão inválida em vez de publicar besteira", () => {
    expect(() => decideBump("nao-e-versao", ["feat(a): x"])).toThrow(/SemVer/);
  });

  it("guarda os commits que motivaram a versão", () => {
    const decision = decideBump("1.0.1", [
      "feat(doca): entrada pela câmera",
      "fix(login): erro de senha",
    ]);

    expect(decision.reasons).toEqual([
      "feat(doca): entrada pela câmera",
      "fix(login): erro de senha",
    ]);
  });

  it("marca no changelog o commit que quebra o contrato", () => {
    const decision = decideBump("1.0.1", ["feat(api)!: remove /legacy"]);

    expect(decision.reasons).toEqual(["feat(api)!: remove /legacy (BREAKING)"]);
  });
});

describe("changelogFor", () => {
  it("lista os commits que motivaram a versão", () => {
    const decision = decideBump("1.0.1", ["feat(doca): entrada pela câmera", "fix(ui): botão"]);

    expect(changelogFor("v1.1.0", decision)).toBe(
      ["## v1.1.0", "", "- feat(doca): entrada pela câmera", "- fix(ui): botão"].join("\n"),
    );
  });
});
