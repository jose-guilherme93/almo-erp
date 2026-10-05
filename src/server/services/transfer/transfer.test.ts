/**
 * Testes do fluxo de transferência entre unidades.
 *
 * O ponto crítico: o material sai do saldo da origem no envio e entra no
 * destino no recebimento. Se algo falhar no meio, nada pode ficar pela metade.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { createAndPostStockDocument } from "@/server/services/stock/post-document";
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  returnTransfer,
  sendTransfer,
} from "@/server/services/transfer";

const TEST_PREFIX = "TRF";
const ACTOR_EMAIL = "autor.transfer@ator.teste.local";

const d = (value: string | number) => new Prisma.Decimal(value);

let databaseAvailable = false;
let actorId = "";
let originBranchId = "";
let destinationBranchId = "";
let originLocationId = "";
let itemId = "";
let unitId = "";
let categoryId = "";

/** Contexto do operador da origem (pode enviar). */
function originContext() {
  return makeAuthContext({
    userId: actorId,
    memberships: [{ branchId: originBranchId, branchCode: "ORIG", roleSlug: "ALMOXARIFE" }],
    permissions: [
      "transferencia:read",
      "transferencia:create",
      "transferencia:enviar",
      "transferencia:receber",
    ],
    activeBranchId: originBranchId,
  });
}

/** Contexto do operador do destino (pode receber). */
function destinationContext() {
  return makeAuthContext({
    userId: actorId,
    memberships: [{ branchId: destinationBranchId, branchCode: "DEST", roleSlug: "ALMOXARIFE" }],
    permissions: [
      "transferencia:read",
      "transferencia:create",
      "transferencia:enviar",
      "transferencia:receber",
    ],
    activeBranchId: destinationBranchId,
  });
}

async function balanceOf(branchId: string): Promise<string> {
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

  // Transferências: descobertas pelas linhas, porque o número é gerado no
  // formato TR-ANO-SEQUENCIAL e não carrega o prefixo de teste.
  if (itemIds.length > 0) {
    const lines = await prisma.transferLine.findMany({
      where: { itemId: { in: itemIds } },
      select: { transferId: true },
    });

    const transferIds = [...new Set(lines.map((line) => line.transferId))];

    if (transferIds.length > 0) {
      await prisma.transferEvent.deleteMany({ where: { transferId: { in: transferIds } } });
      await prisma.transferLine.deleteMany({ where: { transferId: { in: transferIds } } });
      await prisma.transfer.deleteMany({ where: { id: { in: transferIds } } });
    }

    await prisma.stockLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.stockDocument.deleteMany({ where: { createdById: actorId } });
}

/** Cria uma transferência em rascunho com saldo disponível na origem. */
async function newTransfer(quantity = 40) {
  return createTransfer(originContext(), {
    originBranchId,
    destinationBranchId,
    priority: "NORMAL",
    lines: [{ itemId, quantity: String(quantity) }],
  });
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

  originBranchId = branches[0]?.id ?? "";
  destinationBranchId = branches[1]?.id ?? "";

  // Só o local de origem é referenciado aqui: no destino, o próprio serviço
  // resolve o almoxarifado padrão da unidade.
  const originLocation = await prisma.storageLocation.findFirstOrThrow({
    where: { branchId: originBranchId },
    select: { id: true },
  });

  originLocationId = originLocation.id;

  const unit = await prisma.unit.findFirstOrThrow({ where: { code: "UN" }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Transferência", status: "ACTIVE" },
    select: { id: true },
  });

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
      name: "Material Transferível",
      categoryId,
      unitId,
      referencePrice: d(10),
    },
    select: { id: true },
  });

  itemId = item.id;

  // Origem começa com 100 unidades a 5,00.
  await createAndPostStockDocument({
    type: "INBOUND",
    branchId: originBranchId,
    storageLocationId: originLocationId,
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

describe.runIf(process.env["DATABASE_URL"])("fluxo completo", () => {
  it("cria em rascunho sem mexer no saldo", async () => {
    await newTransfer(40);

    expect(await balanceOf(originBranchId)).toBe("100");
    expect(await balanceOf(destinationBranchId)).toBe("0");
  });

  it("enviar baixa o saldo da origem e coloca em trânsito", async () => {
    const transfer = await newTransfer(40);

    const result = await sendTransfer(originContext(), transfer.id);

    expect(result.documentNumber).toMatch(/^MV-/);
    expect(await balanceOf(originBranchId)).toBe("60");

    const saved = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true, sentById: true },
    });

    expect(saved.status).toBe("SENT");
    expect(saved.sentById).toBe(actorId);
  });

  it("dois envios simultâneos baixam o estoque uma única vez", async () => {
    const transfer = await newTransfer(40);

    const results = await Promise.allSettled([
      sendTransfer(originContext(), transfer.id),
      sendTransfer(originContext(), transfer.id),
    ]);

    // Só um envio pode vencer; o outro encontra a transferência já enviada.
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balanceOf(originBranchId)).toBe("60");

    const documents = await prisma.stockDocument.count({
      where: {
        referenceType: "TRANSFER",
        referenceId: transfer.id,
        type: "TRANSFER_OUT",
      },
    });

    expect(documents).toBe(1);
  });

  it("receber credita o destino e fecha a transferência", async () => {
    const transfer = await newTransfer(40);
    await sendTransfer(originContext(), transfer.id);

    const detail = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { lines: { select: { id: true } } },
    });

    const result = await receiveTransfer(destinationContext(), {
      transferId: transfer.id,
      lines: [{ lineId: detail.lines[0]?.id ?? "", quantityReceived: "40" }],
    });

    expect(result.fullyReceived).toBe(true);
    expect(await balanceOf(destinationBranchId)).toBe("40");
    expect(await balanceOf(originBranchId)).toBe("60");

    const saved = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true, receivedAt: true },
    });

    expect(saved.status).toBe("RECEIVED");
    expect(saved.receivedAt).not.toBeNull();
  });

  it("recebimento parcial mantém em trânsito e registra o pendente", async () => {
    const transfer = await newTransfer(40);
    await sendTransfer(originContext(), transfer.id);
    await dispatchTransfer(originContext(), transfer.id);

    const detail = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { lines: { select: { id: true } } },
    });

    const result = await receiveTransfer(destinationContext(), {
      transferId: transfer.id,
      lines: [{ lineId: detail.lines[0]?.id ?? "", quantityReceived: "25" }],
    });

    expect(result.fullyReceived).toBe(false);
    expect(await balanceOf(destinationBranchId)).toBe("25");

    const saved = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true, lines: { select: { quantityReceived: true } } },
    });

    expect(saved.status).toBe("IN_TRANSIT");
    expect(saved.lines[0]?.quantityReceived.toString()).toBe("25");
  });

  it("devolver o pendente credita de volta na origem", async () => {
    const transfer = await newTransfer(40);
    await sendTransfer(originContext(), transfer.id);

    const detail = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { lines: { select: { id: true } } },
    });

    await receiveTransfer(destinationContext(), {
      transferId: transfer.id,
      lines: [{ lineId: detail.lines[0]?.id ?? "", quantityReceived: "25" }],
    });

    await returnTransfer(destinationContext(), {
      transferId: transfer.id,
      reason: "faltaram 15 unidades no transporte",
    });

    // Origem: 100 − 40 (saída) + 15 (devolução) = 75
    expect(await balanceOf(originBranchId)).toBe("75");

    const saved = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true },
    });

    expect(saved.status).toBe("RETURNED");
  });
});

describe.runIf(process.env["DATABASE_URL"])("bloqueios", () => {
  it("recusa enviar sem saldo suficiente e mantém em rascunho", async () => {
    const transfer = await newTransfer(500);

    await expect(sendTransfer(originContext(), transfer.id)).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });

    expect(await balanceOf(originBranchId)).toBe("100");

    const saved = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true },
    });

    expect(saved.status).toBe("DRAFT");
  });

  it("recusa receber mais do que foi enviado", async () => {
    const transfer = await newTransfer(10);
    await sendTransfer(originContext(), transfer.id);

    const detail = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      receiveTransfer(destinationContext(), {
        transferId: transfer.id,
        lines: [{ lineId: detail.lines[0]?.id ?? "", quantityReceived: "15" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("não permite enviar transferência de outra unidade", async () => {
    const transfer = await newTransfer(10);

    await expect(sendTransfer(destinationContext(), transfer.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("não permite receber em unidade que não é o destino", async () => {
    const transfer = await newTransfer(10);
    await sendTransfer(originContext(), transfer.id);

    const detail = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      receiveTransfer(originContext(), {
        transferId: transfer.id,
        lines: [{ lineId: detail.lines[0]?.id ?? "", quantityReceived: "10" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("recusa origem igual ao destino", async () => {
    await expect(
      createTransfer(originContext(), {
        originBranchId,
        destinationBranchId: originBranchId,
        priority: "NORMAL",
        lines: [{ itemId, quantity: "1" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("cancelar em rascunho não movimenta estoque", async () => {
    const transfer = await newTransfer(30);

    await cancelTransfer(originContext(), {
      transferId: transfer.id,
      reason: "pedido cancelado",
    });

    expect(await balanceOf(originBranchId)).toBe("100");

    const saved = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true },
    });

    expect(saved.status).toBe("CANCELLED");
  });

  it("cancelar depois de enviada devolve o saldo", async () => {
    const transfer = await newTransfer(30);
    await sendTransfer(originContext(), transfer.id);

    expect(await balanceOf(originBranchId)).toBe("70");

    await cancelTransfer(originContext(), {
      transferId: transfer.id,
      reason: "erro no endereço de entrega",
    });

    expect(await balanceOf(originBranchId)).toBe("100");
  });

  it("não cancela transferência já recebida", async () => {
    const transfer = await newTransfer(10);
    await sendTransfer(originContext(), transfer.id);

    const detail = await prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { lines: { select: { id: true } } },
    });

    await receiveTransfer(destinationContext(), {
      transferId: transfer.id,
      lines: [{ lineId: detail.lines[0]?.id ?? "", quantityReceived: "10" }],
    });

    // RECEIVED não tem transição de saída na máquina de estados: o erro
    // correto é de transição inválida, não de regra de negócio.
    await expect(
      cancelTransfer(originContext(), { transferId: transfer.id, reason: "tarde demais" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
