/**
 * Testes do fluxo de solicitação de material.
 *
 * Cobre o caminho completo: pedido → aprovação (com reserva de saldo) →
 * entrega (com baixa de estoque). É o requisito central do sistema.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { createAndPostStockDocument } from "@/server/services/stock/post-document";
import {
  approveRequest,
  cancelRequest,
  claimRequest,
  createRequest,
  deliverRequest,
  getRequestDetail,
  listApprovalQueue,
  listRequests,
  rejectRequest,
} from "@/server/services/request";

const TEST_PREFIX = "SOL";
const SOLICITANTE_EMAIL = "autor.solicitante@ator.teste.local";
const APROVADOR_EMAIL = "autor.aprovador@ator.teste.local";

const d = (value: string | number) => new Prisma.Decimal(value);

let databaseAvailable = false;
let solicitanteId = "";
let aprovadorId = "";
let branchId = "";
let locationId = "";
let itemId = "";
let unitId = "";
let categoryId = "";
let otherBranchId = "";

function solicitanteContext() {
  return makeAuthContext({
    userId: solicitanteId,
    email: SOLICITANTE_EMAIL,
    memberships: [{ branchId, roleSlug: "SOLICITANTE" }],
    permissions: ["solicitacao:read", "solicitacao:create"],
    activeBranchId: branchId,
  });
}

function aprovadorContext() {
  return makeAuthContext({
    userId: aprovadorId,
    email: APROVADOR_EMAIL,
    memberships: [{ branchId, roleSlug: "ADMIN_FILIAL" }],
    permissions: [
      "solicitacao:read",
      "solicitacao:create",
      "solicitacao:approve",
      "solicitacao:entregar",
    ],
    activeBranchId: branchId,
  });
}

async function cleanup(): Promise<void> {
  const items = await prisma.item.findMany({
    where: { code: { startsWith: `${TEST_PREFIX}-` } },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);

  const requests = await prisma.request.findMany({
    where: { requesterId: { in: [solicitanteId, aprovadorId] } },
    select: { id: true },
  });
  const requestIds = requests.map((request) => request.id);

  if (requestIds.length > 0) {
    await prisma.delivery.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.stockReservation.deleteMany({
      where: { requestLine: { requestId: { in: requestIds } } },
    });
    await prisma.requestEvent.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.requestLine.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.request.deleteMany({ where: { id: { in: requestIds } } });
  }

  if (itemIds.length > 0) {
    await prisma.stockLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.stockDocument.deleteMany({
    where: { createdById: { in: [solicitanteId, aprovadorId] } },
  });
}

async function balance(): Promise<string> {
  const level = await prisma.stockLevel.findFirst({
    where: { itemId, branchId },
    select: { quantity: true },
  });

  return level?.quantity.toString() ?? "0";
}

async function reserved(): Promise<string> {
  const level = await prisma.stockLevel.findFirst({
    where: { itemId, branchId },
    select: { reservedQuantity: true },
  });

  return level?.reservedQuantity.toString() ?? "0";
}

/**
 * Abre uma solicitação. Ela já nasce enviada para aprovação — não existe mais
 * a etapa de rascunho.
 */
async function newRequest(quantity = 10) {
  return createRequest(solicitanteContext(), {
    branchId,
    lines: [{ itemId, quantity: String(quantity) }],
  });
}

/** Leva a solicitação até aprovada. */
async function approveFully(requestId: string, quantity = 10) {
  const detail = await prisma.request.findUniqueOrThrow({
    where: { id: requestId },
    select: { lines: { select: { id: true } } },
  });

  return approveRequest(aprovadorContext(), {
    requestId,
    lines: [{ lineId: detail.lines[0]?.id ?? "", approvedQuantity: String(quantity) }],
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

  branchId = branches[0]?.id ?? "";
  otherBranchId = branches[1]?.id ?? "";

  const location = await prisma.storageLocation.findFirstOrThrow({
    where: { branchId },
    select: { id: true },
  });

  locationId = location.id;

  const unit = await prisma.unit.findFirstOrThrow({ where: { code: "UN" }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

  unitId = unit.id;
  categoryId = category.id;

  const [solicitante, aprovador] = await Promise.all([
    prisma.user.upsert({
      where: { email: SOLICITANTE_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: SOLICITANTE_EMAIL, name: "Solicitante Teste", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: APROVADOR_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: APROVADOR_EMAIL, name: "Aprovador Teste", status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  solicitanteId = solicitante.id;
  aprovadorId = aprovador.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await cleanup();

  const item = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0001`,
      name: "Material Solicitável",
      categoryId,
      unitId,
      referencePrice: d(12.5),
    },
    select: { id: true },
  });

  itemId = item.id;

  await createAndPostStockDocument({
    type: "INBOUND",
    branchId,
    storageLocationId: locationId,
    createdById: aprovadorId,
    referenceType: "TEST",
    lines: [{ itemId, quantity: d(100), unitCost: d(12.5) }],
  });
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    await prisma.auditLog.deleteMany({
      where: { actorId: { in: [solicitanteId, aprovadorId] } },
    });

    await prisma.user.deleteMany({
      where: { email: { in: [SOLICITANTE_EMAIL, APROVADOR_EMAIL] } },
    });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("abertura", () => {
  it("nasce enviada para aprovação e sem reservar saldo", async () => {
    const request = await newRequest(10);

    const saved = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });

    expect(saved.status).toBe("SUBMITTED");
    expect(await reserved()).toBe("0");
  });

  it("notifica quem responde na unidade escolhida", async () => {
    const request = await newRequest(10);

    const notifications = await prisma.notification.findMany({
      where: { type: "REQUEST_CREATED", entityId: request.id },
    });

    expect(notifications.length).toBeGreaterThan(0);
  });

  it("aceita unidade fora do vínculo do solicitante", async () => {
    // O colaborador pode estar em outra unidade e pedir material de lá.
    const request = await createRequest(solicitanteContext(), {
      branchId: otherBranchId,
      lines: [{ itemId, quantity: "1" }],
    });

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, branchId: true },
    });

    expect(saved.branchId).toBe(otherBranchId);
    expect(saved.status).toBe("SUBMITTED");
  });

  it("o solicitante continua vendo o que pediu para outra unidade", async () => {
    const request = await createRequest(solicitanteContext(), {
      branchId: otherBranchId,
      lines: [{ itemId, quantity: "1" }],
    });

    const detail = await getRequestDetail(solicitanteContext(), request.id);

    expect(detail.branch.id).toBe(otherBranchId);
  });

  it("grava o preço de referência como snapshot da linha", async () => {
    const request = await newRequest(10);

    const line = await prisma.requestLine.findFirstOrThrow({
      where: { requestId: request.id },
    });

    expect(line.unitPriceSnapshot?.toString()).toBe("12.5");
  });

  it("classifica a disponibilidade no momento da criação", async () => {
    const request = await newRequest(10);

    const line = await prisma.requestLine.findFirstOrThrow({
      where: { requestId: request.id },
    });

    expect(line.availabilityStatus).toBe("AVAILABLE");
  });

  it("marca como parcial quando o saldo cobre só uma parte do pedido", async () => {
    const request = await newRequest(500);

    const line = await prisma.requestLine.findFirstOrThrow({
      where: { requestId: request.id },
    });

    expect(line.availabilityStatus).toBe("PARTIAL");
  });

  it("marca como indisponível quando não há saldo nenhum", async () => {
    // Material sem estoque na unidade: existe no catálogo, nunca foi recebido.
    const semEstoque = await prisma.item.create({
      data: {
        code: `${TEST_PREFIX}-SEM-SALDO`,
        name: "Material Nunca Recebido",
        categoryId,
        unitId,
        referencePrice: d(1),
      },
      select: { id: true },
    });

    const request = await createRequest(solicitanteContext(), {
      branchId,
      lines: [{ itemId: semEstoque.id, quantity: "5" }],
    });

    const line = await prisma.requestLine.findFirstOrThrow({
      where: { requestId: request.id },
    });

    expect(line.availabilityStatus).toBe("UNAVAILABLE");
  });

  it("registra o evento de envio já na criação", async () => {
    // Não existe mais a etapa de rascunho: nascer já é entrar na fila.
    const request = await newRequest(10);

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, events: { select: { type: true } } },
    });

    expect(saved.status).toBe("SUBMITTED");
    expect(saved.events.map((event) => event.type)).toContain("SUBMITTED");
  });

  it("assumir a análise move para IN_REVIEW", async () => {
    const request = await newRequest(10);

    await claimRequest(aprovadorContext(), request.id);

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, claimedById: true },
    });

    expect(saved.status).toBe("IN_REVIEW");
    expect(saved.claimedById).toBe(aprovadorId);
  });
});

describe.runIf(process.env["DATABASE_URL"])("aprovação", () => {
  it("o aprovador define a prioridade ao decidir", async () => {
    const request = await newRequest(10);
    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await approveRequest(aprovadorContext(), {
      requestId: request.id,
      priority: "URGENT",
      lines: [{ lineId: detail.lines[0]?.id ?? "", approvedQuantity: "10" }],
    });

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { priority: true },
    });

    expect(saved.priority).toBe("URGENT");
  });

  it("aprovar reserva o saldo sem baixar", async () => {
    const request = await newRequest(10);
    const result = await approveFully(request.id, 10);

    expect(result.fullyApproved).toBe(true);
    expect(await balance()).toBe("100");
    expect(await reserved()).toBe("10");
  });

  it("aprovação parcial exige motivo", async () => {
    const request = await newRequest(10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      approveRequest(aprovadorContext(), {
        requestId: request.id,
        lines: [{ lineId: detail.lines[0]?.id ?? "", approvedQuantity: "4" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("aprovação parcial com motivo registra o que não foi atendido", async () => {
    const request = await newRequest(10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    const result = await approveRequest(aprovadorContext(), {
      requestId: request.id,
      lines: [
        {
          lineId: detail.lines[0]?.id ?? "",
          approvedQuantity: "4",
          nonApprovalReason: "saldo insuficiente para o pedido completo",
        },
      ],
    });

    expect(result.fullyApproved).toBe(false);
    expect(await reserved()).toBe("4");

    const line = await prisma.requestLine.findFirstOrThrow({
      where: { requestId: request.id },
    });

    expect(line.approvedQuantity.toString()).toBe("4");
    expect(line.nonApprovalReason).toContain("saldo insuficiente");
  });

  it("não aprova mais do que foi solicitado", async () => {
    const request = await newRequest(10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      approveRequest(aprovadorContext(), {
        requestId: request.id,
        lines: [{ lineId: detail.lines[0]?.id ?? "", approvedQuantity: "99" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("aprovar sem saldo na unidade falha e nada é reservado", async () => {
    const request = await newRequest(500);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      approveRequest(aprovadorContext(), {
        requestId: request.id,
        lines: [{ lineId: detail.lines[0]?.id ?? "", approvedQuantity: "500" }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await reserved()).toBe("0");

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true },
    });

    expect(saved.status).toBe("SUBMITTED");
  });

  it("rejeitar com motivo muda o status e não reserva nada", async () => {
    const request = await newRequest(10);

    await rejectRequest(aprovadorContext(), {
      requestId: request.id,
      reason: "material não disponível neste trimestre",
    });

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, rejectionReason: true },
    });

    expect(saved.status).toBe("REJECTED");
    expect(saved.rejectionReason).toContain("trimestre");
    expect(await reserved()).toBe("0");
  });

  it("não decide duas vezes a mesma solicitação", async () => {
    const request = await newRequest(10);
    await approveFully(request.id, 10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      approveRequest(aprovadorContext(), {
        requestId: request.id,
        lines: [{ lineId: detail.lines[0]?.id ?? "", approvedQuantity: "10" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("entrega", () => {
  it("entrega baixa o estoque, consome a reserva e gera o comprovante", async () => {
    const request = await newRequest(10);
    await approveFully(request.id, 10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    const result = await deliverRequest(aprovadorContext(), {
      requestId: request.id,
      receivedByName: "Maria da Silva",
      receivedByDocument: "52998224725",
      lines: [{ lineId: detail.lines[0]?.id ?? "", deliveredQuantity: "10" }],
    });

    expect(result.documentNumber).toMatch(/^MV-/);
    expect(await balance()).toBe("90");
    expect(await reserved()).toBe("0");

    const saved = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: {
        status: true,
        deliveredAt: true,
        delivery: { select: { receivedByName: true, receivedByDocument: true } },
        lines: { select: { deliveredQuantity: true } },
      },
    });

    expect(saved.status).toBe("DELIVERED");
    expect(saved.deliveredAt).not.toBeNull();
    expect(saved.delivery?.receivedByName).toBe("Maria da Silva");
    expect(saved.lines[0]?.deliveredQuantity.toString()).toBe("10");
  });

  it("entregar menos que o aprovado libera a diferença da reserva", async () => {
    const request = await newRequest(10);
    await approveFully(request.id, 10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await deliverRequest(aprovadorContext(), {
      requestId: request.id,
      receivedByName: "João Souza",
      lines: [{ lineId: detail.lines[0]?.id ?? "", deliveredQuantity: "6" }],
    });

    expect(await balance()).toBe("94");
    expect(await reserved()).toBe("0");
  });

  it("não entrega sem reserva ativa", async () => {
    const request = await newRequest(10);

    // Pula a aprovação: sem reserva, a entrega é recusada.
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "APPROVED" },
    });

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      deliverRequest(aprovadorContext(), {
        requestId: request.id,
        receivedByName: "Alguém",
        lines: [{ lineId: detail.lines[0]?.id ?? "", deliveredQuantity: "1" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("não entrega mais que o reservado", async () => {
    const request = await newRequest(10);
    await approveFully(request.id, 10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await expect(
      deliverRequest(aprovadorContext(), {
        requestId: request.id,
        receivedByName: "Alguém",
        lines: [{ lineId: detail.lines[0]?.id ?? "", deliveredQuantity: "20" }],
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("cancelamento", () => {
  it("cancelar libera a reserva", async () => {
    const request = await newRequest(10);
    await approveFully(request.id, 10);

    expect(await reserved()).toBe("10");

    await cancelRequest(aprovadorContext(), {
      requestId: request.id,
      reason: "pedido duplicado",
    });

    expect(await reserved()).toBe("0");
    expect(await balance()).toBe("100");
  });

  it("não cancela solicitação já entregue", async () => {
    const request = await newRequest(10);
    await approveFully(request.id, 10);

    const detail = await prisma.request.findUniqueOrThrow({
      where: { id: request.id },
      select: { lines: { select: { id: true } } },
    });

    await deliverRequest(aprovadorContext(), {
      requestId: request.id,
      receivedByName: "Alguém",
      lines: [{ lineId: detail.lines[0]?.id ?? "", deliveredQuantity: "10" }],
    });

    await expect(
      cancelRequest(aprovadorContext(), { requestId: request.id, reason: "tarde demais" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("escopo", () => {
  it("não enxerga solicitação de outra unidade", async () => {
    const request = await newRequest(10);

    const outroContexto = makeAuthContext({
      userId: aprovadorId,
      memberships: [{ branchId: otherBranchId, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["solicitacao:read", "solicitacao:approve"],
      activeBranchId: otherBranchId,
    });

    await expect(getRequestDetail(outroContexto, request.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("o solicitante vê apenas as próprias solicitações, mesmo na mesma unidade", async () => {
    const minha = await newRequest(5);
    const deOutro = await createRequest(aprovadorContext(), {
      branchId,
      lines: [{ itemId, quantity: "5" }],
    });

    const list = await listRequests(solicitanteContext(), {});

    expect(list.items.map((item) => item.id)).toContain(minha.id);
    expect(list.items.map((item) => item.id)).not.toContain(deOutro.id);
  });

  it("a fila sem filial mostra pendências de todas as unidades para quem tem escopo de rede", async () => {
    const minha = await newRequest(5);

    const redeContext = makeAuthContext({
      userId: aprovadorId,
      networkPermissions: ["solicitacao:approve", "solicitacao:overview"],
      networkBranchIds: [branchId, otherBranchId],
      activeBranchId: otherBranchId,
    });

    const queue = await listApprovalQueue(redeContext, null);

    expect(queue.items.map((item) => item.id)).toContain(minha.id);
  });

  it("a fila sem filial cai na filial ativa para quem não tem escopo de rede", async () => {
    const minha = await newRequest(5);
    const outra = await createRequest(
      makeAuthContext({
        userId: aprovadorId,
        memberships: [{ branchId: otherBranchId, roleSlug: "ADMIN_FILIAL" }],
        permissions: ["solicitacao:create"],
        activeBranchId: otherBranchId,
      }),
      { branchId: otherBranchId, lines: [{ itemId, quantity: "5" }] },
    );

    const queue = await listApprovalQueue(aprovadorContext(), null);

    expect(queue.items.map((item) => item.id)).toContain(minha.id);
    expect(queue.items.map((item) => item.id)).not.toContain(outra.id);
  });

  it("com visão geral do almoxarifado, enxerga as solicitações da filial", async () => {
    const deOutro = await createRequest(aprovadorContext(), {
      branchId,
      lines: [{ itemId, quantity: "5" }],
    });

    const overviewContext = makeAuthContext({
      userId: aprovadorId,
      email: APROVADOR_EMAIL,
      memberships: [{ branchId, roleSlug: "ALMOXARIFE" }],
      permissions: ["solicitacao:read", "solicitacao:overview"],
      activeBranchId: branchId,
    });

    const list = await listRequests(overviewContext, {});

    expect(list.items.map((item) => item.id)).toContain(deOutro.id);
  });
});
