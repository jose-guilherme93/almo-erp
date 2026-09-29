/**
 * Testes de reserva de estoque.
 *
 * A reserva é o que impede aprovar uma solicitação sem saldo. Estes testes
 * verificam o ciclo reservar → liberar → consumir.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createAndPostStockDocument } from "@/server/services/stock/post-document";
import {
  consumeReservation,
  releaseReservation,
  reserveStock,
} from "@/server/services/stock/reservation";
import { listBelowMinimum } from "@/server/services/stock/alerts";

const TEST_PREFIX = "RSV";
const ACTOR_EMAIL = "autor.reserva@ator.teste.local";

const d = (value: string | number) => new Prisma.Decimal(value);

let databaseAvailable = false;
let actorId = "";
let branchId = "";
let locationId = "";
let itemId = "";

let unitId = "";
let categoryId = "";
/** Linhas de solicitação fictícias: a FK exige que existam de verdade. */
let requestLineIds: string[] = [];
let requestId = "";

async function cleanup(): Promise<void> {
  if (requestId) {
    await prisma.stockReservation.deleteMany({ where: { requestLine: { requestId } } });
    await prisma.requestEvent.deleteMany({ where: { requestId } });
    await prisma.requestLine.deleteMany({ where: { requestId } });
    await prisma.request.deleteMany({ where: { id: requestId } });
    requestId = "";
    requestLineIds = [];
  }

  const items = await prisma.item.findMany({
    where: { code: { startsWith: `${TEST_PREFIX}-` } },
    select: { id: true },
  });

  if (items.length > 0) {
    const ids = items.map((item) => item.id);

    // Só os saldos destes materiais: outros testes usam a mesma filial.
    await prisma.stockReservation.deleteMany({ where: { stockLevel: { itemId: { in: ids } } } });
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.stockLine.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.itemStockPolicy.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.item.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Cria uma solicitação de apoio para poder reservar linhas reais. */
async function createSupportRequest(): Promise<void> {
  const request = await prisma.request.create({
    data: {
      number: `${TEST_PREFIX}-${Date.now()}`,
      branchId,
      requesterId: actorId,
      status: "APPROVED",
      lines: {
        create: [
          { itemId, requestedQuantity: d(10), availabilityStatus: "AVAILABLE" },
          { itemId, requestedQuantity: d(5), availabilityStatus: "AVAILABLE" },
        ],
      },
    },
    select: { id: true, lines: { select: { id: true } } },
  });

  requestId = request.id;
  requestLineIds = request.lines.map((line) => line.id);
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
    create: { email: ACTOR_EMAIL, name: "Autor Reserva", status: "ACTIVE" },
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

  // O material é recriado a cada teste: o `cleanup` remove os materiais de
  // teste para não deixar resíduo no banco.
  const item = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0001`,
      name: "Material Reservável",
      categoryId,
      unitId,
      referencePrice: d(10),
    },
    select: { id: true },
  });

  itemId = item.id;

  await createSupportRequest();

  await createAndPostStockDocument({
    type: "INBOUND",
    branchId,
    storageLocationId: locationId,
    createdById: actorId,
    referenceType: "TEST",
    lines: [{ itemId, quantity: d(100), unitCost: d(5) }],
  });
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    const actor = await prisma.user.findUnique({
      where: { email: ACTOR_EMAIL },
      select: { id: true },
    });

    if (actor) {
      await prisma.stockLine.deleteMany({ where: { stockDocument: { createdById: actor.id } } });
      await prisma.stockDocument.deleteMany({ where: { createdById: actor.id } });
      await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("reserva", () => {
  it("reserva saldo e bloqueia o disponível", async () => {
    await prisma.$transaction(async (tx) => {
      await reserveStock(tx, {
        branchId,
        createdById: actorId,
        lines: [
          { requestLineId: requestLineIds[0] ?? "", itemId, quantity: d(10) },
          { requestLineId: requestLineIds[1] ?? "", itemId, quantity: d(5) },
        ],
      });
    });

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { itemId, branchId },
    });

    expect(level.quantity.toString()).toBe("100");
    expect(level.reservedQuantity.toString()).toBe("15");
  });

  it("reserva o lote de validade mais próxima (FEFO)", async () => {
    const lotItem = await prisma.item.create({
      data: {
        code: `${TEST_PREFIX}-LOT`,
        name: "Material com Lote",
        categoryId,
        unitId,
        referencePrice: d(10),
        controlledByLot: true,
      },
      select: { id: true },
    });

    const near = await prisma.itemLot.create({
      data: {
        itemId: lotItem.id,
        code: "VENCE-PRIMEIRO",
        expirationDate: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });

    const far = await prisma.itemLot.create({
      data: {
        itemId: lotItem.id,
        code: "VENCE-DEPOIS",
        expirationDate: new Date(Date.now() + 60 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });

    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId: lotItem.id, itemLotId: near.id, quantity: d(2), unitCost: d(1) }],
    });

    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId: lotItem.id, itemLotId: far.id, quantity: d(50), unitCost: d(1) }],
    });

    // Aponta a segunda linha de apoio para o material controlado por lote.
    await prisma.requestLine.update({
      where: { id: requestLineIds[1] ?? "" },
      data: { itemId: lotItem.id },
    });

    await prisma.$transaction(async (tx) => {
      await reserveStock(tx, {
        branchId,
        createdById: actorId,
        lines: [{ requestLineId: requestLineIds[1] ?? "", itemId: lotItem.id, quantity: d(2) }],
      });
    });

    const reservation = await prisma.stockReservation.findUniqueOrThrow({
      where: { requestLineId: requestLineIds[1] ?? "" },
      select: { lotId: true },
    });

    // FEFO: sai antes o lote que vence primeiro, apesar de o outro ter mais saldo.
    expect(reservation.lotId).toBe(near.id);
  });

  it("recusa reserva maior que o disponível", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await reserveStock(tx, {
          branchId,
          createdById: actorId,
          lines: [{ requestLineId: requestLineIds[0] ?? "", itemId, quantity: d(150) }],
        });
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    const level = await prisma.stockLevel.findFirstOrThrow({ where: { itemId, branchId } });
    expect(level.reservedQuantity.toString()).toBe("0");
  });

  it("libera a reserva ao rejeitar", async () => {
    await prisma.$transaction(async (tx) => {
      await reserveStock(tx, {
        branchId,
        createdById: actorId,
        lines: [{ requestLineId: requestLineIds[0] ?? "", itemId, quantity: d(20) }],
      });
    });

    await prisma.$transaction(async (tx) => {
      await releaseReservation(tx, { requestLineId: requestLineIds[0] ?? "" });
    });

    const level = await prisma.stockLevel.findFirstOrThrow({ where: { itemId, branchId } });

    expect(level.reservedQuantity.toString()).toBe("0");

    const reservation = await prisma.stockReservation.findUniqueOrThrow({
      where: { requestLineId: requestLineIds[0] ?? "" },
      select: { status: true },
    });

    expect(reservation.status).toBe("RELEASED");
  });

  it("consome a reserva marcando como CONSUMED", async () => {
    await prisma.$transaction(async (tx) => {
      await reserveStock(tx, {
        branchId,
        createdById: actorId,
        lines: [{ requestLineId: requestLineIds[0] ?? "", itemId, quantity: d(8) }],
      });
    });

    await prisma.$transaction(async (tx) => {
      await consumeReservation(tx, { requestLineId: requestLineIds[0] ?? "", quantity: d(8) });
    });

    const reservation = await prisma.stockReservation.findUniqueOrThrow({
      where: { requestLineId: requestLineIds[0] ?? "" },
      select: { status: true, quantity: true },
    });

    expect(reservation.status).toBe("CONSUMED");
    expect(reservation.quantity.toString()).toBe("0");
  });

  it("não super-reserva sob aprovações simultâneas", async () => {
    // Saldo de 100. Duas reservas de 60 correm ao mesmo tempo: só uma pode
    // passar, e o reservado nunca pode ultrapassar o saldo.
    const results = await Promise.allSettled([
      prisma.$transaction(async (tx) => {
        await reserveStock(tx, {
          branchId,
          createdById: actorId,
          lines: [{ requestLineId: requestLineIds[0] ?? "", itemId, quantity: d(60) }],
        });
      }),
      prisma.$transaction(async (tx) => {
        await reserveStock(tx, {
          branchId,
          createdById: actorId,
          lines: [{ requestLineId: requestLineIds[1] ?? "", itemId, quantity: d(60) }],
        });
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");

    expect(fulfilled).toHaveLength(1);

    const level = await prisma.stockLevel.findFirstOrThrow({ where: { itemId, branchId } });

    expect(level.reservedQuantity.toString()).toBe("60");
    expect(level.reservedQuantity.lessThanOrEqualTo(level.quantity)).toBe(true);
  });

  it("o banco recusa saldo negativo", async () => {
    await expect(
      prisma.$executeRaw`UPDATE stock_levels SET quantity = -1 WHERE item_id = ${itemId} AND branch_id = ${branchId}`,
    ).rejects.toBeTruthy();
  });

  it("não libera mais do que foi reservado", async () => {
    await prisma.$transaction(async (tx) => {
      await reserveStock(tx, {
        branchId,
        createdById: actorId,
        lines: [{ requestLineId: requestLineIds[0] ?? "", itemId, quantity: d(4) }],
      });
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await releaseReservation(tx, {
          requestLineId: requestLineIds[0] ?? "",
          quantity: d(9),
        });
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("alertas de mínimo", () => {
  it("lista item abaixo do mínimo e calcula a falta", async () => {
    await prisma.itemStockPolicy.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      update: { minimumQuantity: d(150) },
      create: { itemId, branchId, minimumQuantity: d(150) },
    });

    const alerts = await listBelowMinimum({ branchId });

    const alert = alerts.find((row) => row.itemId === itemId);

    expect(alert).toBeDefined();
    expect(alert?.availableQuantity.toString()).toBe("100");
    expect(alert?.shortage.toString()).toBe("50");
  });

  it("não alerta quando o saldo está acima do mínimo", async () => {
    await prisma.itemStockPolicy.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      update: { minimumQuantity: d(10) },
      create: { itemId, branchId, minimumQuantity: d(10) },
    });

    const alerts = await listBelowMinimum({ branchId });

    expect(alerts.find((row) => row.itemId === itemId)).toBeUndefined();
  });

  it("ignora mínimo zero (material sem controle de reposição)", async () => {
    await prisma.itemStockPolicy.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      update: { minimumQuantity: d(0) },
      create: { itemId, branchId, minimumQuantity: d(0) },
    });

    const alerts = await listBelowMinimum({ branchId });

    expect(alerts.find((row) => row.itemId === itemId)).toBeUndefined();
  });
});
