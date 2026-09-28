/**
 * Testes do inventário.
 *
 * O que precisa ser provado: a contagem não mexe no estoque, o ajuste mexe, e
 * divergência sem justificativa é recusada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { createAndPostStockDocument } from "@/server/services/stock/post-document";
import {
  applyInventoryAdjustment,
  cancelInventorySession,
  closeInventoryCounting,
  createInventorySession,
  getInventorySession,
  saveCount,
} from "@/server/services/inventory";

const TEST_PREFIX = "INV";
const ACTOR_EMAIL = "autor.inventario@ator.teste.local";

const d = (value: string | number) => new Prisma.Decimal(value);

let databaseAvailable = false;
let actorId = "";
let branchId = "";
let locationId = "";
let itemId = "";
let unitId = "";
let categoryId = "";

function context() {
  return makeAuthContext({
    userId: actorId,
    memberships: [{ branchId, roleSlug: "ALMOXARIFE" }],
    permissions: ["inventario:read", "inventario:manage", "estoque:read", "estoque:ajuste"],
    activeBranchId: branchId,
  });
}

async function balance(): Promise<string> {
  const level = await prisma.stockLevel.findFirst({
    where: { itemId, branchId },
    select: { quantity: true },
  });

  return level?.quantity.toString() ?? "0";
}

async function cleanup(): Promise<void> {
  const items = await prisma.item.findMany({
    where: { code: { startsWith: `${TEST_PREFIX}-` } },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);

  const sessions = await prisma.inventorySession.findMany({
    where: { branchId, createdById: actorId },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  if (sessionIds.length > 0) {
    await prisma.inventoryLine.deleteMany({ where: { inventorySessionId: { in: sessionIds } } });
    await prisma.inventorySession.deleteMany({ where: { id: { in: sessionIds } } });
  }

  if (itemIds.length > 0) {
    await prisma.stockLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.stockDocument.deleteMany({ where: { createdById: actorId } });
}

/** Abre um inventário com os itens do teste. */
async function openSession() {
  return createInventorySession(context(), { branchId, storageLocationId: locationId });
}

async function firstLineId(sessionId: string): Promise<string> {
  const line = await prisma.inventoryLine.findFirstOrThrow({
    where: { inventorySessionId: sessionId },
    select: { id: true },
  });

  return line.id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const branch = await prisma.branch.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });
  const location = await prisma.storageLocation.findFirstOrThrow({
    where: { branchId: branch.id },
    select: { id: true },
  });
  const unit = await prisma.unit.findFirstOrThrow({ where: { code: "UN" }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Inventário", status: "ACTIVE" },
    select: { id: true },
  });

  branchId = branch.id;
  locationId = location.id;
  unitId = unit.id;
  categoryId = category.id;
  actorId = actor.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await cleanup();

  const item = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0001`,
      name: "Material Inventariável",
      categoryId,
      unitId,
      referencePrice: d(10),
    },
    select: { id: true },
  });

  itemId = item.id;

  await createAndPostStockDocument({
    type: "INBOUND",
    branchId,
    storageLocationId: locationId,
    createdById: actorId,
    referenceType: "TEST",
    lines: [{ itemId, quantity: d(50), unitCost: d(10) }],
  });
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.notification.deleteMany({ where: { userId: actorId } });
    await prisma.user.deleteMany({ where: { email: ACTOR_EMAIL } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("contagem", () => {
  it("abre a sessão congelando a quantidade do sistema", async () => {
    const session = await openSession();

    const detail = await getInventorySession(context(), session.id);
    const line = detail.lines.find((entry) => entry.item.id === itemId);

    expect(line?.systemQuantity.toString()).toBe("50");
    expect(line?.countedQuantity).toBeNull();
    expect(detail.status).toBe("COUNTING");
  });

  it("contar não mexe no estoque", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "47" });

    expect(await balance()).toBe("50");

    const line = await prisma.inventoryLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.countedQuantity?.toString()).toBe("47");
    expect(line.difference?.toString()).toBe("-3");
  });

  it("campo vazio significa não contado, não zero", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "10" });
    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: null });

    const line = await prisma.inventoryLine.findUniqueOrThrow({ where: { id: lineId } });

    expect(line.countedQuantity).toBeNull();
    expect(line.difference).toBeNull();
  });

  it("recusa quantidade negativa", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await expect(
      saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "-1" }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("encerramento e ajuste", () => {
  it("não encerra sem nenhuma contagem", async () => {
    const session = await openSession();

    await expect(
      closeInventoryCounting(context(), { sessionId: session.id }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("encerrar com divergência não ajusta o estoque ainda", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "45" });
    await closeInventoryCounting(context(), { sessionId: session.id });

    expect(await balance()).toBe("50");

    const saved = await prisma.inventorySession.findUniqueOrThrow({
      where: { id: session.id },
      select: { status: true },
    });

    expect(saved.status).toBe("CLOSED");
  });

  it("aplicar ajuste corrige o saldo para o valor contado", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "45" });
    await closeInventoryCounting(context(), { sessionId: session.id });

    const result = await applyInventoryAdjustment(context(), {
      sessionId: session.id,
      justifications: [{ lineId, justification: "material encontrado em outro corredor" }],
    });

    expect(result.divergentLines).toBe(1);
    expect(await balance()).toBe("45");

    const saved = await prisma.inventorySession.findUniqueOrThrow({
      where: { id: session.id },
      select: { status: true },
    });

    expect(saved.status).toBe("ADJUSTED");
  });

  it("ajuste para cima também funciona", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "58" });
    await closeInventoryCounting(context(), { sessionId: session.id });

    await applyInventoryAdjustment(context(), {
      sessionId: session.id,
      justifications: [{ lineId, justification: "entrada lançada a menor no sistema" }],
    });

    expect(await balance()).toBe("58");
  });

  it("exige justificativa em toda linha divergente", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "45" });
    await closeInventoryCounting(context(), { sessionId: session.id });

    await expect(
      applyInventoryAdjustment(context(), {
        sessionId: session.id,
        justifications: [{ lineId, justification: "" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    expect(await balance()).toBe("50");
  });

  it("recusa ajustar quando não há divergência", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "50" });
    await closeInventoryCounting(context(), { sessionId: session.id });

    await expect(
      applyInventoryAdjustment(context(), {
        sessionId: session.id,
        justifications: [{ lineId, justification: "sem divergência" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("gera notificação de divergência para quem acompanha", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "40" });
    await closeInventoryCounting(context(), { sessionId: session.id });

    await applyInventoryAdjustment(context(), {
      sessionId: session.id,
      justifications: [{ lineId, justification: "quebra identificada na contagem" }],
    });

    const notifications = await prisma.notification.findMany({
      where: { type: "INVENTORY_DIVERGENCE", entityId: session.id },
    });

    expect(notifications.length).toBeGreaterThan(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("cancelamento", () => {
  it("cancelar não altera o saldo", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "1" });
    await cancelInventorySession(context(), {
      sessionId: session.id,
      reason: "contagem interrompida",
    });

    expect(await balance()).toBe("50");

    const saved = await prisma.inventorySession.findUniqueOrThrow({
      where: { id: session.id },
      select: { status: true },
    });

    expect(saved.status).toBe("CANCELLED");
  });

  it("não cancela inventário já ajustado", async () => {
    const session = await openSession();
    const lineId = await firstLineId(session.id);

    await saveCount(context(), { sessionId: session.id, lineId, countedQuantity: "45" });
    await closeInventoryCounting(context(), { sessionId: session.id });
    await applyInventoryAdjustment(context(), {
      sessionId: session.id,
      justifications: [{ lineId, justification: "divergência apurada na contagem" }],
    });

    await expect(
      cancelInventorySession(context(), { sessionId: session.id, reason: "tarde demais" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
