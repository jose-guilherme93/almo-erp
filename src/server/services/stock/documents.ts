import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { resolveWorkingBranch } from "@/server/auth/scope";
import type { AuthContext } from "@/server/auth/context";

/** Consulta de documentos de movimentação de estoque. */

export type StockDocumentFilters = {
  type?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  storageLocationId?: string | null;
  page?: number;
  pageSize?: number;
};

const DOCUMENT_TYPES = [
  "INBOUND",
  "ISSUE",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "RETURN",
  "INVENTORY",
] as const;

export async function listStockDocuments(context: AuthContext, filters: StockDocumentFilters = {}) {
  const branchId = resolveWorkingBranch(context, null);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.StockDocumentWhereInput = {
    branchId,
    ...(filters.type && (DOCUMENT_TYPES as readonly string[]).includes(filters.type)
      ? { type: filters.type as (typeof DOCUMENT_TYPES)[number] }
      : {}),
    ...(filters.status ? { status: filters.status as "POSTED" | "DRAFT" | "CANCELLED" } : {}),
    ...(filters.storageLocationId ? { storageLocationId: filters.storageLocationId } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [documents, total] = await Promise.all([
    prisma.stockDocument.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        date: true,
        totalQuantity: true,
        totalCost: true,
        branch: { select: { code: true } },
        storageLocation: { select: { name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.stockDocument.count({ where }),
  ]);

  return {
    items: documents.map((document) => ({
      id: document.id,
      number: document.number,
      type: document.type,
      status: document.status,
      date: document.date,
      totalQuantity: document.totalQuantity.toString(),
      totalCost: document.totalCost.toString(),
      branchCode: document.branch.code,
      storageLocationName: document.storageLocation.name,
      createdByName: document.createdBy.name,
      lineCount: document._count.lines,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Documento com linhas e vínculos, para a tela de detalhe. */
export async function getStockDocument(context: AuthContext, documentId: string) {
  return prisma.stockDocument.findFirst({
    where: { id: documentId, branchId: { in: context.branchIds } },
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      date: true,
      notes: true,
      referenceType: true,
      referenceId: true,
      totalQuantity: true,
      totalCost: true,
      postedAt: true,
      branch: { select: { id: true, code: true, name: true } },
      storageLocation: { select: { id: true, code: true, name: true } },
      destinationLocation: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      reversalDocument: { select: { id: true, number: true, createdAt: true } },
      reversalOf: { select: { id: true, number: true, createdAt: true } },
      delivery: { select: { id: true, requestId: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          unitCost: true,
          lineTotal: true,
          item: {
            select: { id: true, code: true, name: true, unit: { select: { code: true } } },
          },
          itemLot: { select: { id: true, code: true, expirationDate: true } },
        },
      },
    },
  });
}

/** Documentos de um material específico (usado na aba de estoque do material). */
export async function listItemMovements(context: AuthContext, itemId: string, limit = 20) {
  const branchId = resolveWorkingBranch(context, null);

  return prisma.stockLine.findMany({
    where: { itemId, stockDocument: { branchId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      quantity: true,
      unitCost: true,
      createdAt: true,
      stockDocument: {
        select: { id: true, number: true, type: true, status: true, date: true },
      },
    },
  });
}
