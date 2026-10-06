import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import {
  pruneErrorLogs,
  pruneErrorLogsIfDue,
  resetRetentionClock,
} from "@/server/services/observability/retention";

/**
 * Poda do `ErrorLog`.
 *
 * O risco da poda é ela **errar o que é seguro apagar**: cortar erro ainda
 * aberto, ou o único registro de um defeito que ninguém olhou. O que se prova
 * aqui é que ela só leva o que é antigo **e** já resolvido, e que o teto corta
 * do mais antigo para o mais novo.
 *
 * Os limites vêm por parâmetro justamente para o teste não precisar de 5 mil
 * linhas — nem varrer o banco de quem está rodando a suíte.
 */

const PREFIX = "retencao-teste:";

const DAY = 24 * 60 * 60 * 1_000;

let databaseAvailable = false;

async function seed(overrides: {
  ageDays: number;
  resolved: boolean;
  tag: string;
  lastSeenDaysAgo?: number;
}) {
  const createdAt = new Date(Date.now() - overrides.ageDays * DAY);
  const lastSeenAt = new Date(Date.now() - (overrides.lastSeenDaysAgo ?? overrides.ageDays) * DAY);

  return prisma.errorLog.create({
    data: {
      fingerprint: `${PREFIX}${overrides.tag}`,
      routePath: `${PREFIX}${overrides.tag}`,
      routeType: "render",
      message: "Erro de teste da retenção",
      firstSeenAt: createdAt,
      lastSeenAt,
      resolvedAt: overrides.resolved ? createdAt : null,
    },
    select: { id: true },
  });
}

async function countSeeded(): Promise<number> {
  return prisma.errorLog.count({ where: { routePath: { startsWith: PREFIX } } });
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

  await prisma.errorLog.deleteMany({ where: { routePath: { startsWith: PREFIX } } });
  resetRetentionClock();
});

afterAll(async () => {
  if (!databaseAvailable) return;

  await prisma.errorLog.deleteMany({ where: { routePath: { startsWith: PREFIX } } });
});

describe("pruneErrorLogsIfDue", () => {
  // O controle de intervalo é medido pelo efeito: uma linha podável que
  // **sobrevive** prova que a poda não rodou. Sem efeito observável o teste
  // só confirmaria que a função não lançou.
  it("podou na primeira chamada", async () => {
    if (!databaseAvailable) return;

    await seed({ ageDays: 200, resolved: true, tag: "a-podar" });

    await pruneErrorLogsIfDue(Date.now());

    expect(await countSeeded()).toBe(0);
  });

  it("não roda de novo dentro da mesma hora", async () => {
    if (!databaseAvailable) return;

    const start = Date.now();

    await pruneErrorLogsIfDue(start);

    // Nova linha podável, e a janela ainda não passou.
    await seed({ ageDays: 200, resolved: true, tag: "dentro-da-janela" });
    await pruneErrorLogsIfDue(start + 60 * 60_000 - 1);

    expect(await countSeeded()).toBe(1);
  });

  it("volta a rodar depois de uma hora", async () => {
    if (!databaseAvailable) return;

    const start = Date.now();

    await pruneErrorLogsIfDue(start);

    await seed({ ageDays: 200, resolved: true, tag: "depois-da-janela" });
    await pruneErrorLogsIfDue(start + 60 * 60_000 + 1);

    expect(await countSeeded()).toBe(0);
  });
});

describe("pruneErrorLogs", () => {
  it("leva erro resolvido e antigo", async () => {
    if (!databaseAvailable) return;

    await seed({ ageDays: 120, resolved: true, tag: "velho-resolvido" });

    const result = await pruneErrorLogs({ resolvedAfterDays: 90 });

    expect(result.removedByAge).toBeGreaterThanOrEqual(1);
    expect(await countSeeded()).toBe(0);
  });

  // O erro que ninguém olhou é o que interessa. Apagá-lo é perder o defeito.
  it("mantém erro aberto mesmo que antigo", async () => {
    if (!databaseAvailable) return;

    await seed({ ageDays: 200, resolved: false, tag: "velho-aberto" });

    await pruneErrorLogs({ resolvedAfterDays: 90 });

    expect(await countSeeded()).toBe(1);
  });

  it("mantém erro resolvido que ainda é recente", async () => {
    if (!databaseAvailable) return;

    await seed({ ageDays: 5, resolved: true, tag: "novo-resolvido" });

    await pruneErrorLogs({ resolvedAfterDays: 90 });

    expect(await countSeeded()).toBe(1);
  });

  it("mantém erro resolvido que continua voltando", async () => {
    if (!databaseAvailable) return;

    // Triado há 200 dias, mas a recorrência é desta semana: o defeito ainda
    // está acontecendo, então apagá-lo seria esconder o problema.
    await seed({ ageDays: 200, resolved: true, tag: "resolvido-que-volta", lastSeenDaysAgo: 2 });

    await pruneErrorLogs({ resolvedAfterDays: 90 });

    expect(await countSeeded()).toBe(1);
  });

  it("respeita o teto e corta do mais antigo para o mais novo", async () => {
    if (!databaseAvailable) return;

    // O teto conta a tabela **inteira**, e o banco pode ter linhas de outras
    // execuções. Comparar com um número absoluto deixaria o teste passar ou falhar
    // conforme o que sobrou no banco — então o total é medido aqui, e a linha
    // do teste é a mais antiga possível para que a ordenação não seja ambígua.
    const totalAntes = await prisma.errorLog.count();

    await seed({ ageDays: 10_000, resolved: false, tag: "a-mais-antiga" });
    await seed({ ageDays: 1, resolved: false, tag: "recem" });

    const result = await pruneErrorLogs({ maxRows: totalAntes + 1 });

    expect(result.removedByCap).toBe(1);

    // Cortou a mais antiga: quando o sistema está quebrando, o erro de agora vale
    // mais que o de ontem.
    expect(await countSeeded()).toBe(1);

    const restantes = await prisma.errorLog.findMany({
      where: { routePath: { startsWith: PREFIX } },
      select: { routePath: true },
    });

    expect(restantes.map((row) => row.routePath)).toEqual([`${PREFIX}recem`]);
  });

  it("não apaga nada quando está dentro do teto", async () => {
    if (!databaseAvailable) return;

    await seed({ ageDays: 1, resolved: false, tag: "unica" });

    const result = await pruneErrorLogs({ maxRows: 100 });

    expect(result.removedByCap).toBe(0);
    expect(await countSeeded()).toBe(1);
  });
});
