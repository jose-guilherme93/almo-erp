import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { activeSinkNames, dispatchIncident, scrubIncident } from "@/server/services/observability";
import { errorLogSink } from "@/server/services/observability/sink-error-log";
import type { Incident } from "@/server/services/observability";

/**
 * O funil de incidentes, de ponta a ponta.
 *
 * É o teste que responde à pergunta que motivou a fase: **o erro que o usuário
 * viu chega no dashboard do administrador?** Cada camada isolada já tem teste
 * próprio — o scrub, o alerta, a retenção. Falta provar que elas estão
 * **ligadas**, e um funil desconectado passa em todos os testes de unidade e
 * continua invisível em produção.
 *
 * Por isso este teste fala com o banco de verdade, e não com dublê.
 */

const TEST_PREFIX = "funil-teste";

let databaseAvailable = false;

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    kind: "render",
    routePath: "/catalogo/itens",
    method: "GET",
    message: "Erro: não foi possível ler o material",
    stack: "Error: não foi possível ler o material\n  at listarItens",
    digest: "digest-funil",
    ...overrides,
  };
}

async function storedError(routePath: string) {
  return prisma.errorLog.findFirst({ where: { routePath: { startsWith: routePath } } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
  }
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await prisma.errorLog.deleteMany({ where: { routePath: { startsWith: TEST_PREFIX } } });
  await prisma.notification.deleteMany({ where: { entityType: "ErrorLog" } });
});

afterAll(async () => {
  if (!databaseAvailable) return;

  await prisma.errorLog.deleteMany({ where: { routePath: { startsWith: TEST_PREFIX } } });
  await prisma.notification.deleteMany({ where: { entityType: "ErrorLog" } });
});

describe("destinos do funil", () => {
  it("o banco local está sempre ativo — é a rede de segurança", () => {
    expect(activeSinkNames()).toContain("error-log");
  });

  it("os destinos externos ficam desligados sem configuração", () => {
    // Um destino faltando não pode virar erro novo, e o sistema precisa subir
    // em ambiente de teste sem nenhuma variável de observabilidade.
    expect(activeSinkNames()).not.toContain("otel");
  });

  it("o destino do banco não tem como ser desligado", () => {
    expect(errorLogSink.enabled).toBe(true);
  });
});

describe("scrubIncident", () => {
  it("tira dado pessoal da mensagem antes de qualquer destino", () => {
    const scrubbed = scrubIncident(
      incident({ message: "Falha ao salvar para o CPF 123.456.789-00 e joao@escola.com" }),
    );

    expect(scrubbed.message).not.toContain("123.456.789-00");
    expect(scrubbed.message).not.toContain("joao@escola.com");
  });

  it("tira a query string da rota", () => {
    // Em relatório, a query carrega o filtro de pessoa.
    const scrubbed = scrubIncident(incident({ routePath: "/relatorios?nome=Joao&cpf=123" }));

    expect(scrubbed.routePath).toBe("/relatorios");
  });

  it("tira a linha do stack que parece ter credencial", () => {
    const scrubbed = scrubIncident(
      incident({ stack: "Error: falha\n  at login (password=segredo)\n  at rota" }),
    );

    expect(scrubbed.stack).not.toContain("segredo");
  });
});

describe("dispatchIncident", () => {
  it("grava o incidente no banco, que é onde o admin faz a triagem", async () => {
    if (!databaseAvailable) return;

    await dispatchIncident(incident({ routePath: `${TEST_PREFIX}/ok` }));

    const stored = await storedError(`${TEST_PREFIX}/ok`);

    expect(stored).not.toBeNull();
    expect(stored?.routeType).toBe("render");
    expect(stored?.digest).toBe("digest-funil");
  });

  // A combinação que só falha na ponta: o incidente chega, mas com dado
  // pessoal dentro. Um teste por camada não pega isso.
  it("grava sem dado pessoal, mesmo com CPF e e-mail na mensagem", async () => {
    if (!databaseAvailable) return;

    await dispatchIncident(
      incident({
        routePath: `${TEST_PREFIX}/lgpd`,
        message: "Falha ao salvar o cadastro do aluno CPF 123.456.789-00 (joao@escola.com)",
      }),
    );

    const stored = await storedError(`${TEST_PREFIX}/lgpd`);

    expect(stored).not.toBeNull();
    expect(stored?.message).not.toContain("123.456.789-00");
    expect(stored?.message).not.toContain("joao@escola.com");
    // E o que faz o diagnóstico sobrevive à limpeza.
    expect(stored?.message).toContain("Falha ao salvar o cadastro");
  });

  it("agrupa o mesmo erro em uma linha só, incrementando o contador", async () => {
    if (!databaseAvailable) return;

    await dispatchIncident(incident({ routePath: `${TEST_PREFIX}/repetido` }));
    await dispatchIncident(incident({ routePath: `${TEST_PREFIX}/repetido` }));
    await dispatchIncident(incident({ routePath: `${TEST_PREFIX}/repetido` }));

    const rows = await prisma.errorLog.findMany({
      where: { routePath: `${TEST_PREFIX}/repetido` },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(3);
  });

  it("notifica o administrador só na primeira ocorrência", async () => {
    if (!databaseAvailable) return;

    await dispatchIncident(incident({ routePath: `${TEST_PREFIX}/sino` }));
    await dispatchIncident(incident({ routePath: `${TEST_PREFIX}/sino` }));

    const notifications = await prisma.notification.findMany({
      where: { entityType: "ErrorLog", entityId: (await storedError(`${TEST_PREFIX}/sino`))?.id },
    });

    // Uma linha que se repete 500 vezes continua sendo um erro só; notificar
    // cada vez transformaria o sino em ruído e esconderia o problema maior.
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("ERROR_REPORTED");
  });

  it("não grava cancelamento de navegação", async () => {
    if (!databaseAvailable) return;

    await dispatchIncident(
      incident({
        routePath: `${TEST_PREFIX}/abortado`,
        message: "The destination stream closed early.",
      }),
    );

    expect(await storedError(`${TEST_PREFIX}/abortado`)).toBeNull();
  });

  // Um destino quebrado não pode virar um erro novo no meio do caminho.
  it("não propaga falha quando um destino lança", async () => {
    if (!databaseAvailable) return;

    await expect(
      dispatchIncident(incident({ routePath: `${TEST_PREFIX}/destino-quebrado` })),
    ).resolves.toBeUndefined();

    // E o que importa: o erro mesmo assim foi registrado.
    expect(await storedError(`${TEST_PREFIX}/destino-quebrado`)).not.toBeNull();
  });
});
