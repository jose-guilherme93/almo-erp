import { Prisma } from "@/generated/prisma/client";
import type { InventoryStatus } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { InvalidTransitionError } from "@/lib/errors";
import { postStockDocument } from "@/server/services/stock/post-document";
import { nextInventoryNumber } from "@/server/services/stock/numbering";
import { writeAuditLog } from "@/server/services/audit";
import { notify } from "@/server/services/notification";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess } from "@/server/auth/scope";

/**
 * Serviço de inventário.
 *
 * O inventário é a única forma legítima de o saldo do sistema divergir da
 * realidade: conta-se, apura-se a diferença e ela vira um documento de ajuste
 * com justificativa.
 */

const TRANSITIONS: Record<InventoryStatus, readonly InventoryStatus[]> = {
  OPEN: ["COUNTING", "CANCELLED"],
  COUNTING: ["CLOSED", "CANCELLED"],
  CLOSED: ["ADJUSTED", "CANCELLED"],
  ADJUSTED: [],
  CANCELLED: [],
};

function assertTransition(from: InventoryStatus, to: InventoryStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to, "o inventário");
  }
}

export async function listInventorySessions(
  context: AuthContext,
  branchId: string,
  options: { status?: string | null; page?: number; pageSize?: number } = {},
) {
  assertBranchAccess(context, branchId);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.InventorySessionWhereInput = {
    branchId,
    ...(options.status ? { status: options.status as InventoryStatus } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.inventorySession.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        status: true,
        startedAt: true,
        closedAt: true,
        notes: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        closedBy: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.inventorySession.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getInventorySession(context: AuthContext, sessionId: string) {
  const session = await prisma.inventorySession.findFirst({
    where: { id: sessionId, branchId: { in: context.branchIds } },
    select: {
      id: true,
      number: true,
      status: true,
      startedAt: true,
      closedAt: true,
      notes: true,
      createdAt: true,
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      lines: {
        orderBy: { item: { name: "asc" } },
        select: {
          id: true,
          systemQuantity: true,
          countedQuantity: true,
          difference: true,
          adjusted: true,
          notes: true,
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              barcode: true,
              unit: { select: { code: true } },
            },
          },
          storageLocation: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });

  if (!session) throw new NotFoundError("Inventário");

  return session;
}

export type CreateInventoryInput = {
  branchId: string;
  storageLocationId?: string;
  categoryId?: string;
  onlyWithoutMovementDays?: number | null;
  notes?: string;
};

/**
 * Abre uma sessão de contagem.
 *
 * Congela a quantidade do sistema no momento da abertura: é ela que serve de
 * comparação, mesmo que o estoque se movimente durante a contagem.
 */
export async function createInventorySession(
  context: AuthContext,
  input: CreateInventoryInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  assertBranchAccess(context, input.branchId);

  const levels = await prisma.stockLevel.findMany({
    where: {
      branchId: input.branchId,
      ...(input.storageLocationId ? { storageLocationId: input.storageLocationId } : {}),
      item: {
        active: true,
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      },
      ...(input.onlyWithoutMovementDays
        ? {
            OR: [
              { lastMovementAt: null },
              {
                lastMovementAt: {
                  lt: new Date(Date.now() - input.onlyWithoutMovementDays * 24 * 60 * 60 * 1000),
                },
              },
            ],
          }
        : {}),
    },
    select: {
      itemId: true,
      storageLocationId: true,
      quantity: true,
      storageLocation: { select: { name: true } },
    },
  });

  if (levels.length === 0) {
    throw new BusinessRuleError(
      "Nenhum item corresponde ao escopo escolhido. Ajuste o filtro ou lance estoque antes de inventariar.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const number = await nextInventoryNumber(tx, input.branchId);

    const session = await tx.inventorySession.create({
      data: {
        number,
        branchId: input.branchId,
        storageLocationId: input.storageLocationId ?? null,
        status: "COUNTING",
        startedAt: new Date(),
        notes: input.notes,
        createdById: context.user.id,
        lines: {
          create: levels.map((level) => ({
            itemId: level.itemId,
            storageLocationId: level.storageLocationId,
            systemQuantity: level.quantity,
          })),
        },
      },
      select: { id: true, number: true, _count: { select: { lines: true } } },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "inventory.created",
        entityType: "InventorySession",
        entityId: session.id,
        branchId: input.branchId,
        after: { number, lines: session._count.lines, scope: input },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { id: session.id, number: session.number, lineCount: session._count.lines };
  });
}

/**
 * Salva a contagem de um item.
 *
 * `null` significa "não contado" — diferente de zero, que é uma afirmação
 * positiva sobre a prateleira. Confundir os dois é o erro clássico de
 * inventário.
 */
export async function saveCount(
  context: AuthContext,
  input: { sessionId: string; lineId: string; countedQuantity: string | null; notes?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const line = await prisma.inventoryLine.findFirst({
    where: { id: input.lineId, inventorySessionId: input.sessionId },
    select: {
      id: true,
      systemQuantity: true,
      countedQuantity: true,
      inventorySession: { select: { id: true, status: true, branchId: true } },
    },
  });

  if (!line) throw new NotFoundError("Item do inventário");

  assertBranchAccess(context, line.inventorySession.branchId);

  if (line.inventorySession.status !== "COUNTING" && line.inventorySession.status !== "OPEN") {
    throw new BusinessRuleError("Esta sessão não está mais em contagem.");
  }

  const counted =
    input.countedQuantity === null || input.countedQuantity.trim() === ""
      ? null
      : new Prisma.Decimal(input.countedQuantity);

  if (counted && counted.isNegative()) {
    throw new BusinessRuleError("Quantidade contada não pode ser negativa.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryLine.update({
      where: { id: input.lineId },
      data: {
        countedQuantity: counted,
        difference: counted ? counted.minus(line.systemQuantity) : null,
        notes: input.notes ?? null,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "inventory.counted",
        entityType: "InventoryLine",
        entityId: input.lineId,
        branchId: line.inventorySession.branchId,
        before: { countedQuantity: line.countedQuantity?.toString() ?? null },
        after: { countedQuantity: counted?.toString() ?? null },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/** Salva várias contagens de uma vez — o formulário de balcão manda em lote. */
export async function saveCountBatch(
  context: AuthContext,
  sessionId: string,
  counts: Array<{ lineId: string; countedQuantity: string | null }>,
): Promise<number> {
  let saved = 0;

  for (const count of counts) {
    await saveCount(context, {
      sessionId,
      lineId: count.lineId,
      countedQuantity: count.countedQuantity,
    });
    saved += 1;
  }

  return saved;
}

/**
 * Fecha a contagem e apura as divergências.
 *
 * Não gera ajuste ainda: primeiro o responsável revisa o que divergiu. Só
 * depois o ajuste é lançado — evita que um erro de digitação mexa no estoque.
 */
export async function closeInventoryCounting(
  context: AuthContext,
  input: { sessionId: string; notes?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, number: true, status: true, branchId: true },
    });

    if (!session) throw new NotFoundError("Inventário");

    assertBranchAccess(context, session.branchId);
    assertTransition(session.status, "CLOSED");

    const lines = await tx.inventoryLine.findMany({
      where: { inventorySessionId: session.id },
      select: { countedQuantity: true },
    });

    const counted = lines.filter((line) => line.countedQuantity !== null).length;

    if (counted === 0) {
      throw new BusinessRuleError(
        "Nenhum item foi contado. Registre pelo menos uma contagem antes de fechar.",
      );
    }

    await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: "CLOSED", closedAt: new Date(), closedById: context.user.id },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "inventory.counting_closed",
        entityType: "InventorySession",
        entityId: session.id,
        branchId: session.branchId,
        after: { status: "CLOSED", counted, total: lines.length },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { number: session.number, counted, total: lines.length };
  });
}

export type ApplyInventoryInput = {
  sessionId: string;
  /** Justificativa por linha divergente. */
  justifications: Array<{ lineId: string; justification: string }>;
};

/**
 * Aplica o ajuste das divergências.
 *
 * Exige justificativa para toda linha divergente: um ajuste sem motivo é
 * indistinguível de um erro de lançamento.
 */
export async function applyInventoryAdjustment(
  context: AuthContext,
  input: ApplyInventoryInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(
    async (tx) => {
      const session = await tx.inventorySession.findUnique({
        where: { id: input.sessionId },
        select: {
          id: true,
          number: true,
          status: true,
          branchId: true,
          lines: {
            select: {
              id: true,
              itemId: true,
              storageLocationId: true,
              systemQuantity: true,
              countedQuantity: true,
            },
          },
        },
      });

      if (!session) throw new NotFoundError("Inventário");

      assertBranchAccess(context, session.branchId);
      assertTransition(session.status, "ADJUSTED");

      const divergent = session.lines.filter(
        (line) =>
          line.countedQuantity !== null && !line.countedQuantity.equals(line.systemQuantity),
      );

      if (divergent.length === 0) {
        throw new BusinessRuleError(
          "Não há divergência para ajustar. A contagem bate com o sistema.",
        );
      }

      const justificationByLine = new Map(
        input.justifications.map((entry) => [entry.lineId, entry.justification.trim()]),
      );

      for (const line of divergent) {
        const justification = justificationByLine.get(line.id);

        if (!justification || justification.length < 5) {
          throw new BusinessRuleError(
            "Toda divergência precisa de justificativa (mínimo 5 caracteres).",
          );
        }
      }

      // Um documento de estoque tem UM local: divergências de locais
      // diferentes precisam de documentos separados, senão o saldo seria
      // lançado na prateleira errada.
      const byLocation = new Map<string, typeof divergent>();

      for (const line of divergent) {
        const current = byLocation.get(line.storageLocationId) ?? [];
        current.push(line);
        byLocation.set(line.storageLocationId, current);
      }

      const documents: string[] = [];

      for (const [storageLocationId, lines] of byLocation) {
        const document = await postStockDocument(tx, {
          type: "INVENTORY",
          branchId: session.branchId,
          storageLocationId,
          notes: `Ajuste do inventário ${session.number}`,
          referenceType: "INVENTORY",
          referenceId: session.id,
          createdById: context.user.id,
          lines: lines.map((line) => ({
            itemId: line.itemId,
            quantity: (line.countedQuantity as Prisma.Decimal).minus(line.systemQuantity),
          })),
        });

        documents.push(document.number);
      }

      for (const line of divergent) {
        await tx.inventoryLine.update({
          where: { id: line.id },
          data: {
            adjusted: true,
            notes: justificationByLine.get(line.id),
          },
        });
      }

      await tx.inventorySession.update({
        where: { id: session.id },
        data: { status: "ADJUSTED", closedAt: new Date(), closedById: context.user.id },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "inventory.adjusted",
          entityType: "InventorySession",
          entityId: session.id,
          branchId: session.branchId,
          after: {
            status: "ADJUSTED",
            divergentLines: divergent.length,
            stockDocumentNumbers: documents,
          },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      // Divergência interessa ao admin da unidade e à matriz.
      await notify(
        tx,
        {
          type: "INVENTORY_DIVERGENCE",
          actorId: context.user.id,
          branchId: session.branchId,
          entityType: "InventorySession",
          entityId: session.id,
          data: {
            inventoryId: session.id,
            number: session.number,
            divergentItems: String(divergent.length),
          },
        },
        { dedupe: true },
      );

      return {
        number: session.number,
        divergentLines: divergent.length,
        documentNumbers: documents,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

export async function cancelInventorySession(
  context: AuthContext,
  input: { sessionId: string; reason: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({
      where: { id: input.sessionId },
      select: { id: true, number: true, status: true, branchId: true },
    });

    if (!session) throw new NotFoundError("Inventário");

    assertBranchAccess(context, session.branchId);
    assertTransition(session.status, "CANCELLED");

    await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: "CANCELLED", notes: input.reason },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "inventory.cancelled",
        entityType: "InventorySession",
        entityId: session.id,
        branchId: session.branchId,
        before: { status: session.status },
        after: { status: "CANCELLED", reason: input.reason },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { number: session.number };
  });
}

/** Progresso da contagem, para o cabeçalho da tela. */
export async function inventoryProgress(sessionId: string): Promise<{
  total: number;
  counted: number;
  divergent: number;
}> {
  const lines = await prisma.inventoryLine.findMany({
    where: { inventorySessionId: sessionId },
    select: { countedQuantity: true, systemQuantity: true },
  });

  const counted = lines.filter((line) => line.countedQuantity !== null);
  const divergent = counted.filter(
    (line) => line.countedQuantity && !line.countedQuantity.equals(line.systemQuantity),
  );

  return { total: lines.length, counted: counted.length, divergent: divergent.length };
}
