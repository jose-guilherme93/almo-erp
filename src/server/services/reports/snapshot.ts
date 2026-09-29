import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { ReportExportFormat } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";
import { visibleBranchIds } from "@/server/auth/scope";
import {
  REPORTS,
  type ReportId,
  type ReportResult,
  type ReportScope,
} from "@/server/services/reports";

/**
 * Relatórios consolidados.
 *
 * Consolidar é congelar: a fotografia do relatório (dados, filtros e escopo) é
 * persistida com hash de conteúdo e **nunca** pode ser alterada. O banco recusa
 * `UPDATE`/`DELETE` em `report_snapshots` (trigger na migration). Cada saída
 * (CSV, impressão/PDF, Drive) vira um `ReportExport` — a trilha de auditoria de
 * quem exportou o quê, quando e para onde.
 */

export type SnapshotMetadata = { ip?: string | null; userAgent?: string | null };

/** Rows/headers livres de tipos não-JSON (Decimal, undefined) para persistir. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Hash canônico do relatório consolidado. */
export function hashReportContent(input: {
  reportId: string;
  periodFrom: Date;
  periodTo: Date;
  branchIds: readonly string[];
  categoryId: string | null;
  headers: readonly string[];
  rows: unknown;
}): string {
  const canonical = JSON.stringify({
    reportId: input.reportId,
    from: input.periodFrom.toISOString(),
    to: input.periodTo.toISOString(),
    branchIds: [...input.branchIds].sort(),
    categoryId: input.categoryId,
    headers: input.headers,
    rows: input.rows,
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function snapshotVisibilityFilter(context: AuthContext): Prisma.ReportSnapshotWhereInput {
  if (context.isNetworkScope) return {};

  // Quem gerou enxerga o próprio; quem tem acesso à filial enxerga o da filial.
  return {
    OR: [{ generatedById: context.user.id }, { branchIds: { hasSome: visibleBranchIds(context) } }],
  };
}

function auditBranchId(branchIds: readonly string[]): string | null {
  return branchIds.length === 1 ? (branchIds[0] ?? null) : null;
}

export type ConsolidateInput = {
  reportId: ReportId;
  scope: ReportScope;
  result: ReportResult;
  format: ReportExportFormat;
  destination?: string | null;
  destinationUrl?: string | null;
  metadata?: SnapshotMetadata;
};

/**
 * Congela o relatório e registra a exportação — tudo na mesma transação.
 *
 * A partir daqui o conteúdo é imutável: o `contentHash` fecha a evidência.
 */
export async function consolidateReport(
  context: AuthContext,
  input: ConsolidateInput,
): Promise<{ snapshotId: string; exportId: string; contentHash: string }> {
  const label = REPORTS.find((report) => report.id === input.reportId)?.label ?? input.reportId;
  const headersJson = toJson(input.result.headers);
  const rowsJson = toJson(input.result.rows);
  const params = toJson({
    from: input.scope.from.toISOString(),
    to: input.scope.to.toISOString(),
    branchId: input.scope.branchIds.length === 1 ? input.scope.branchIds[0] : null,
    categoryId: input.scope.categoryId ?? null,
  });

  const contentHash = hashReportContent({
    reportId: input.reportId,
    periodFrom: input.scope.from,
    periodTo: input.scope.to,
    branchIds: input.scope.branchIds,
    categoryId: input.scope.categoryId ?? null,
    headers: input.result.headers,
    rows: JSON.parse(JSON.stringify(input.result.rows)),
  });

  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.reportSnapshot.create({
      data: {
        reportId: input.reportId,
        reportLabel: label,
        params,
        periodFrom: input.scope.from,
        periodTo: input.scope.to,
        branchIds: [...input.scope.branchIds],
        headers: headersJson,
        rows: rowsJson,
        rowCount: input.result.rows.length,
        summary: input.result.summary,
        contentHash,
        generatedById: context.user.id,
      },
      select: { id: true },
    });

    const exported = await tx.reportExport.create({
      data: {
        snapshotId: snapshot.id,
        format: input.format,
        actorId: context.user.id,
        destination: input.destination ?? null,
        destinationUrl: input.destinationUrl ?? null,
        ip: input.metadata?.ip ?? null,
        userAgent: input.metadata?.userAgent ?? null,
      },
      select: { id: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "report.snapshot_created",
        entityType: "ReportSnapshot",
        entityId: snapshot.id,
        branchId: auditBranchId(input.scope.branchIds),
        after: {
          reportId: input.reportId,
          contentHash,
          rowCount: input.result.rows.length,
          format: input.format,
        },
        ip: input.metadata?.ip,
        userAgent: input.metadata?.userAgent,
      },
      tx,
    );

    return { snapshotId: snapshot.id, exportId: exported.id, contentHash };
  });
}

/**
 * Registra uma saída sobre um snapshot já consolidado (ex.: upload ao Drive
 * feito pelo navegador). Não altera o snapshot — só acrescenta auditoria.
 */
export async function recordReportExport(
  context: AuthContext,
  input: {
    snapshotId: string;
    format: ReportExportFormat;
    destination?: string | null;
    destinationUrl?: string | null;
    metadata?: SnapshotMetadata;
  },
): Promise<{ exportId: string }> {
  const snapshot = await getReportSnapshot(context, input.snapshotId);

  return prisma.$transaction(async (tx) => {
    const exported = await tx.reportExport.create({
      data: {
        snapshotId: snapshot.id,
        format: input.format,
        actorId: context.user.id,
        destination: input.destination ?? null,
        destinationUrl: input.destinationUrl ?? null,
        ip: input.metadata?.ip ?? null,
        userAgent: input.metadata?.userAgent ?? null,
      },
      select: { id: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "report.exported",
        entityType: "ReportSnapshot",
        entityId: snapshot.id,
        branchId: auditBranchId(snapshot.branchIds),
        after: { format: input.format, destination: input.destination ?? null },
        ip: input.metadata?.ip,
        userAgent: input.metadata?.userAgent,
      },
      tx,
    );

    return { exportId: exported.id };
  });
}

/** Lista paginada dos relatórios consolidados visíveis ao usuário. */
export async function listReportSnapshots(
  context: AuthContext,
  options: { reportId?: string | null; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.ReportSnapshotWhereInput = {
    ...snapshotVisibilityFilter(context),
    ...(options.reportId ? { reportId: options.reportId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.reportSnapshot.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        reportId: true,
        reportLabel: true,
        periodFrom: true,
        periodTo: true,
        rowCount: true,
        summary: true,
        contentHash: true,
        createdAt: true,
        branchIds: true,
        generatedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { exports: true } },
      },
    }),
    prisma.reportSnapshot.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Detalhe do snapshot (dados congelados) + histórico de exportações. */
export async function getReportSnapshot(context: AuthContext, snapshotId: string) {
  const snapshot = await prisma.reportSnapshot.findFirst({
    where: { id: snapshotId, ...snapshotVisibilityFilter(context) },
    select: {
      id: true,
      reportId: true,
      reportLabel: true,
      params: true,
      periodFrom: true,
      periodTo: true,
      branchIds: true,
      headers: true,
      rows: true,
      rowCount: true,
      summary: true,
      contentHash: true,
      createdAt: true,
      generatedBy: { select: { id: true, name: true, email: true } },
      exports: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          format: true,
          destination: true,
          destinationUrl: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
    },
  });

  if (!snapshot) throw new NotFoundError("Relatório consolidado");

  return snapshot;
}

/** Filiais de um conjunto de snapshots, para exibir o escopo. */
export async function branchCodesFor(branchIds: readonly string[]): Promise<string[]> {
  if (branchIds.length === 0) return [];

  const branches = await prisma.branch.findMany({
    where: { id: { in: [...branchIds] } },
    orderBy: { code: "asc" },
    select: { code: true },
  });

  return branches.map((branch) => branch.code);
}
