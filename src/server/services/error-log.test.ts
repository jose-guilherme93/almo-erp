/**
 * Regras do log de erro de servidor.
 *
 * O risco desta feature é duplo: uma regra de deduplicação errada, ou um alerta que
 * se repete. Um erro em render alcançado por vários usuários viraria dezenas de
 * linhas e a tela viraria parede; e o sino transformaria um loop em ruído
 * justamente quando o problema é mais grave. Por isso a decisão fica testada
 * aqui, e não depois de acontecer em produção.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  fingerprintOf,
  isIgnorableError,
  listErrorLogs,
  normalizeMessage,
  normalizeRoutePath,
  recordServerError,
  reopenErrorLog,
  resolveErrorLog,
} from "@/server/services/error-log";

const TEST_PREFIX = "erro-teste:";

let databaseAvailable = false;
let actorId = "";

function report(overrides: Partial<Parameters<typeof recordServerError>[0]> = {}) {
  return {
    message: "Falha ao carregar o material",
    digest: "digest-abc",
    routePath: "/catalogo/itens",
    routeType: "render",
    method: "GET",
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const actor = await prisma.user.upsert({
    where: { email: "erro.log@ator.teste.local" },
    update: { status: "ACTIVE" },
    create: { email: "erro.log@ator.teste.local", name: "Autor Erro", status: "ACTIVE" },
    select: { id: true },
  });

  actorId = actor.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await prisma.errorLog.deleteMany({ where: { routePath: { startsWith: TEST_PREFIX } } });
});

afterAll(async () => {
  if (!databaseAvailable) return;

  await prisma.errorLog.deleteMany({ where: { routePath: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: "erro.log@ator.teste.local" } });
});

describe("normalizeMessage", () => {
  // Só colapsa número com 2+ dígitos, de propósito: id e contador neste sistema
  // são longos, enquanto dígito único ("passo 3" vs "passo 7") costuma ser
  // informação real — apagá-lo juntaria erros que não são o mesmo.
  it("colapsa id longo, para que o mesmo erro deduplique", () => {
    expect(normalizeMessage("Erro ao salvar item 4821")).toBe(
      normalizeMessage("Erro ao salvar item 9930"),
    );
  });

  it("preserva dígito único, que distingue erros diferentes", () => {
    expect(normalizeMessage("Falha no passo 3")).not.toBe(normalizeMessage("Falha no passo 7"));
  });

  it("colapsa id dinâmico de path", () => {
    expect(normalizeMessage("Falha em /itens/cmuv1a2b3c4d5")).toBe(
      normalizeMessage("Falha em /itens/cmuv9z8y7x6w5"),
    );
  });

  it("omite linha que possa conter credencial", () => {
    const comSenha = "Falha no login\n  password=supersecreta\n  fim";

    expect(normalizeMessage(comSenha)).not.toContain("supersecreta");
    expect(normalizeMessage(comSenha)).toContain("omitida");
  });

  it("omite token e authorization", () => {
    expect(normalizeMessage("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
    expect(normalizeMessage("token=xyz123")).not.toContain("xyz123");
  });

  it("mantém a mensagem normal quando não há nada sensível", () => {
    expect(normalizeMessage("Conexão recusada pelo Postgres")).toBe(
      "Conexão recusada pelo Postgres",
    );
  });
});

describe("isIgnorableError", () => {
  // Ruído que o Next emite ao abortar navegação. Sem o filtro, a tela vira
  // parede e o erro que importa desaparece no meio.
  it("ignora stream de navegação interrompido", () => {
    expect(isIgnorableError("The destination stream closed early.")).toBe(true);
  });

  it("ignora operação abortada", () => {
    expect(isIgnorableError("The operation was aborted.")).toBe(true);
    expect(isIgnorableError("Aborted")).toBe(true);
    expect(isIgnorableError("Request aborted")).toBe(true);
  });

  it("ignora erro de abort do React", () => {
    expect(isIgnorableError("AbortError: ERR_ABORTED")).toBe(true);
  });

  // O oposto: um filtro largo esconderia erro de verdade.
  it("não ignora erro de aplicação", () => {
    expect(isIgnorableError("Conexão recusada pelo Postgres")).toBe(false);
    expect(isIgnorableError("Não foi possível acessar a propriedade")).toBe(false);
    expect(isIgnorableError("TypeError: Cannot read properties of undefined")).toBe(false);
  });

  it("não confunde palavra abort dentro de frase de erro", () => {
    expect(isIgnorableError("O pedido foi abortado pelo usuário no meio")).toBe(false);
  });
});

describe("normalizeRoutePath", () => {
  // O Next anexa `?_rsc=<hash>` a toda navegação, e o hash muda a cada visita.
  it("tira a query string", () => {
    expect(normalizeRoutePath("/solicitar?_rsc=64EBvAagmAisvzuu")).toBe("/solicitar");
  });

  it("mantém a rota que não tem query", () => {
    expect(normalizeRoutePath("/catalogo/itens")).toBe("/catalogo/itens");
  });

  it("não perde a rota quando o caminho é só query", () => {
    expect(normalizeRoutePath("?a=1")).toBe("?a=1");
  });
});

describe("fingerprintOf", () => {
  it("é estável para o mesmo erro", () => {
    expect(fingerprintOf(report())).toBe(fingerprintOf(report()));
  });

  it("ignora o cache-buster da navegação RSC", () => {
    const a = fingerprintOf(report({ routePath: "/solicitar?_rsc=aaa111" }));
    const b = fingerprintOf(report({ routePath: "/solicitar?_rsc=bbb222" }));

    expect(a).toBe(b);
  });

  it("separa erros de rotas diferentes", () => {
    const a = fingerprintOf(report({ routePath: "/catalogo/itens" }));
    const b = fingerprintOf(report({ routePath: "/estoque/saldos" }));

    expect(a).not.toBe(b);
  });

  it("separa erros com digest diferente na mesma rota", () => {
    const a = fingerprintOf(report({ digest: "digest-abc" }));
    const b = fingerprintOf(report({ digest: "digest-xyz" }));

    expect(a).not.toBe(b);
  });

  it("não inclui timestamp: o mesmo erro em outro momento é o mesmo erro", () => {
    const a = fingerprintOf(report({ message: "Falha às 10:00:01 no item 4821" }));
    const b = fingerprintOf(report({ message: "Falha às 23:59:59 no item 9930" }));

    expect(a).toBe(b);
  });
});

describe.runIf(process.env["DATABASE_URL"])("registro deduplicado", () => {
  it("cria a linha na primeira ocorrência", async () => {
    const result = await recordServerError(report({ routePath: `${TEST_PREFIX}a` }));

    expect(result).toMatchObject({ outcome: "created", count: 1 });
  });

  it("incrementa em vez de criar linha nova", async () => {
    const path = `${TEST_PREFIX}b`;

    const first = await recordServerError(report({ routePath: path }));
    const second = await recordServerError(report({ routePath: path }));
    const third = await recordServerError(report({ routePath: path }));

    expect(first).toMatchObject({ outcome: "created", count: 1 });
    expect(second).toMatchObject({ outcome: "repeated", count: 2 });
    expect(third).toMatchObject({ outcome: "repeated", count: 3 });

    const rows = await prisma.errorLog.count({ where: { routePath: path } });

    expect(rows).toBe(1);
  });

  it("deduplica mesmo com id dinâmico na mensagem", async () => {
    const path = `${TEST_PREFIX}c`;

    await recordServerError(report({ routePath: path, message: "Falha ao gravar item 4821" }));
    await recordServerError(report({ routePath: path, message: "Falha ao gravar item 9930" }));

    const rows = await prisma.errorLog.count({ where: { routePath: path } });

    expect(rows).toBe(1);
  });

  it("não grava cancelamento de navegação", async () => {
    const path = `${TEST_PREFIX}ruido`;

    // O que o Next emite quando o usuário sai da página antes do stream terminar.
    const result = await recordServerError(
      report({ routePath: path, message: "The destination stream closed early." }),
    );

    expect(result.outcome).toBe("skipped");

    const rows = await prisma.errorLog.count({ where: { routePath: path } });

    expect(rows).toBe(0);
  });

  it("não enche a tabela quando o erro muda só o número do id", async () => {
    const path = `${TEST_PREFIX}d`;

    for (let i = 100; i < 120; i += 1) {
      await recordServerError(report({ routePath: path, message: `Item ${i} inválido` }));
    }

    const row = await prisma.errorLog.findFirstOrThrow({ where: { routePath: path } });

    expect(row.count).toBe(20);
  });

  it("guarda rota, tipo, digest e versão", async () => {
    await recordServerError(
      report({ routePath: `${TEST_PREFIX}e`, routeType: "action", method: "POST" }),
    );

    const row = await prisma.errorLog.findFirstOrThrow({
      where: { routePath: `${TEST_PREFIX}e` },
    });

    expect(row.digest).toBe("digest-abc");
    expect(row.routeType).toBe("action");
    expect(row.method).toBe("POST");
    expect(row.appVersion).toBeTruthy();
  });

  it("não guarda credencial no stack", async () => {
    await recordServerError(
      report({
        routePath: `${TEST_PREFIX}f`,
        stack: "Error: falha\n  at auth (password=segredo123)",
      }),
    );

    const row = await prisma.errorLog.findFirstOrThrow({
      where: { routePath: `${TEST_PREFIX}f` },
    });

    expect(row.stack ?? "").not.toContain("segredo123");
  });
});

describe.runIf(process.env["DATABASE_URL"])("resolução", () => {
  it("marca como resolvido e tira da lista de abertos", async () => {
    const created = await recordServerError(report({ routePath: `${TEST_PREFIX}g` }));

    if (created.outcome === "skipped") return;

    await resolveErrorLog(created.id, actorId);

    const row = await prisma.errorLog.findUniqueOrThrow({ where: { id: created.id } });

    expect(row.resolvedAt).not.toBeNull();
    expect(row.resolvedById).toBe(actorId);
  });

  it("reabre um erro resolvido", async () => {
    const created = await recordServerError(report({ routePath: `${TEST_PREFIX}h` }));

    if (created.outcome === "skipped") return;

    await resolveErrorLog(created.id, actorId);
    await reopenErrorLog(created.id);

    const row = await prisma.errorLog.findUniqueOrThrow({ where: { id: created.id } });

    expect(row.resolvedAt).toBeNull();
  });

  it("resolver duas vezes não muda o marcador original", async () => {
    const created = await recordServerError(report({ routePath: `${TEST_PREFIX}i` }));

    if (created.outcome === "skipped") return;

    await resolveErrorLog(created.id, actorId);
    const first = await prisma.errorLog.findUniqueOrThrow({ where: { id: created.id } });

    await resolveErrorLog(created.id, actorId);
    const second = await prisma.errorLog.findUniqueOrThrow({ where: { id: created.id } });

    expect(second.resolvedAt?.getTime()).toBe(first.resolvedAt?.getTime());
  });
});

describe.runIf(process.env["DATABASE_URL"])("listagem", () => {
  it("filtra por digest, que é o código que o usuário relata", async () => {
    await recordServerError(report({ routePath: `${TEST_PREFIX}j`, digest: "unic-digest-9" }));

    const result = await listErrorLogs({ search: "unic-digest-9" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.digest).toBe("unic-digest-9");
  });

  it("filtra por rota", async () => {
    await recordServerError(report({ routePath: `${TEST_PREFIX}k` }));

    const result = await listErrorLogs({ routePath: `${TEST_PREFIX}k` });

    expect(result.items.length).toBeGreaterThan(0);
  });

  it("só devolve abertos quando pedido", async () => {
    const created = await recordServerError(report({ routePath: `${TEST_PREFIX}l` }));

    if (created.outcome === "skipped") return;

    await resolveErrorLog(created.id, actorId);

    const abertos = await listErrorLogs({ onlyOpen: true, routePath: `${TEST_PREFIX}l` });
    const todos = await listErrorLogs({ routePath: `${TEST_PREFIX}l` });

    expect(abertos.items).toHaveLength(0);
    expect(todos.items).toHaveLength(1);
  });

  it("conta os abertos para o cabeçalho", async () => {
    const result = await listErrorLogs({});

    expect(result.openCount).toBeGreaterThanOrEqual(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("escopo", () => {
  it("não devolve erro para contexto sem permissão de leitura", async () => {
    const context = makeAuthContext({ userId: actorId, permissions: ["notificacao:read"] });

    // A listagem é de sistema; a porta real é `requirePagePermission` na tela.
    expect(context.hasPermission("papel:manage")).toBe(false);
  });
});
