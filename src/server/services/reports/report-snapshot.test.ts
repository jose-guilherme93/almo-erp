/**
 * Testes de relatórios consolidados.
 *
 * Provam o que o pedido exige: consolidar congela (hash + dados), cada saída
 * fica auditada e **nunca** é possível editar ou apagar um consolidado.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { buildScope, type ReportResult } from "@/server/services/reports";
import {
  consolidateReport,
  getReportSnapshot,
  hashReportContent,
  listReportSnapshots,
  recordReportExport,
} from "@/server/services/reports/snapshot";

const ACTOR_EMAIL = "auditor.relatorio@ator.teste.local";
const OUTRO_EMAIL = "outro.relatorio@ator.teste.local";

let databaseAvailable = false;
let actorId = "";
let otherId = "";
let branchId = "";
let otherBranchId = "";

function actorContext() {
  return makeAuthContext({
    userId: actorId,
    email: ACTOR_EMAIL,
    networkPermissions: ["relatorio:read"],
    networkBranchIds: [branchId],
    activeBranchId: branchId,
  });
}

function otherBranchContext() {
  return makeAuthContext({
    userId: otherId,
    email: OUTRO_EMAIL,
    memberships: [{ branchId: otherBranchId, roleSlug: "GESTOR" }],
    permissions: ["relatorio:read"],
    activeBranchId: otherBranchId,
  });
}

function scopeFor() {
  return buildScope(actorContext(), { from: "2026-01-01", to: "2026-12-31" });
}

function sampleResult(): ReportResult {
  return {
    headers: ["Código", "Quantidade"],
    rows: [
      ["A-1", 10],
      ["B-2", 20],
    ],
    summary: "2 material(is)",
  };
}

async function truncateReports(): Promise<void> {
  // `report_snapshots` é imutável (trigger) — o reset de teste usa TRUNCATE.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "report_exports", "report_snapshots"');
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const branches = await prisma.branch.findMany({
    where: { active: true },
    take: 2,
    select: { id: true },
  });

  if (branches.length < 2) {
    databaseAvailable = false;
    return;
  }

  branchId = branches[0]?.id ?? "";
  otherBranchId = branches[1]?.id ?? "";

  const [actor, other] = await Promise.all([
    prisma.user.upsert({
      where: { email: ACTOR_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: ACTOR_EMAIL, name: "Auditor Relatório", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: OUTRO_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: OUTRO_EMAIL, name: "Outra Unidade", status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  actorId = actor.id;
  otherId = other.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await prisma.auditLog.deleteMany({ where: { actorId: { in: [actorId, otherId] } } });
  await truncateReports();
});

afterAll(async () => {
  if (databaseAvailable) {
    await truncateReports();
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [actorId, otherId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [ACTOR_EMAIL, OUTRO_EMAIL] } } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("relatórios consolidados", () => {
  it("congela o relatório com hash e registra a exportação", async () => {
    const { snapshotId, contentHash } = await consolidateReport(actorContext(), {
      reportId: "valor-estoque",
      scope: scopeFor(),
      result: sampleResult(),
      format: "PRINT",
    });

    const snapshot = await prisma.reportSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
      select: {
        reportId: true,
        reportLabel: true,
        rowCount: true,
        summary: true,
        contentHash: true,
        headers: true,
        rows: true,
        generatedById: true,
        exports: { select: { format: true, actorId: true } },
      },
    });

    expect(snapshot.reportId).toBe("valor-estoque");
    expect(snapshot.reportLabel).toBe("Valor de estoque");
    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.contentHash).toBe(contentHash);
    expect(snapshot.headers).toEqual(["Código", "Quantidade"]);
    expect(snapshot.rows).toEqual([
      ["A-1", 10],
      ["B-2", 20],
    ]);
    expect(snapshot.generatedById).toBe(actorId);
    expect(snapshot.exports).toHaveLength(1);
    expect(snapshot.exports[0]?.format).toBe("PRINT");

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "ReportSnapshot",
        entityId: snapshotId,
        action: "report.snapshot_created",
      },
    });

    expect(audit).not.toBeNull();
  });

  it("o hash é estável para o mesmo conteúdo e muda quando o dado muda", () => {
    const base = {
      reportId: "valor-estoque",
      periodFrom: new Date("2026-01-01T00:00:00.000Z"),
      periodTo: new Date("2026-12-31T00:00:00.000Z"),
      branchIds: [branchId],
      categoryId: null,
      headers: ["Código", "Quantidade"],
    };

    const first = hashReportContent({ ...base, rows: [["A-1", 10]] });
    const same = hashReportContent({ ...base, rows: [["A-1", 10]] });
    const changed = hashReportContent({ ...base, rows: [["A-1", 11]] });

    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it("não permite editar nem apagar um relatório consolidado", async () => {
    const { snapshotId } = await consolidateReport(actorContext(), {
      reportId: "consumo-material",
      scope: scopeFor(),
      result: sampleResult(),
      format: "CSV",
    });

    await expect(
      prisma.reportSnapshot.update({ where: { id: snapshotId }, data: { summary: "alterado" } }),
    ).rejects.toThrow();

    await expect(prisma.reportSnapshot.delete({ where: { id: snapshotId } })).rejects.toThrow();

    const still = await prisma.reportSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
      select: { summary: true },
    });

    expect(still.summary).toBe("2 material(is)");
  });

  it("registra exportações adicionais (Drive) sobre o snapshot, sem alterá-lo", async () => {
    const { snapshotId } = await consolidateReport(actorContext(), {
      reportId: "movimentacoes",
      scope: scopeFor(),
      result: sampleResult(),
      format: "PRINT",
    });

    await recordReportExport(actorContext(), {
      snapshotId,
      format: "DRIVE",
      destination: "movimentacoes.csv",
      destinationUrl: "https://drive.google.com/file/d/abc/view",
    });

    const snapshot = await getReportSnapshot(actorContext(), snapshotId);

    expect(snapshot.exports.map((entry) => entry.format).sort()).toEqual(["DRIVE", "PRINT"]);
    expect(snapshot.summary).toBe("2 material(is)");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "ReportSnapshot", entityId: snapshotId, action: "report.exported" },
    });

    expect(audit).not.toBeNull();
  });

  it("respeita o escopo de filial na leitura do consolidado", async () => {
    const { snapshotId } = await consolidateReport(actorContext(), {
      reportId: "reposicao",
      scope: scopeFor(),
      result: sampleResult(),
      format: "CSV",
    });

    await expect(getReportSnapshot(otherBranchContext(), snapshotId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const list = await listReportSnapshots(otherBranchContext(), {});

    expect(list.items.some((item) => item.id === snapshotId)).toBe(false);
  });

  it("lista os consolidados do escopo com contagem de saídas", async () => {
    const { snapshotId } = await consolidateReport(actorContext(), {
      reportId: "duracao-demandas",
      scope: scopeFor(),
      result: sampleResult(),
      format: "PRINT",
    });

    await recordReportExport(actorContext(), { snapshotId, format: "CSV" });

    const list = await listReportSnapshots(actorContext(), {});

    const found = list.items.find((item) => item.id === snapshotId);

    expect(found).toBeDefined();
    expect(found?._count.exports).toBe(2);
  });
});
