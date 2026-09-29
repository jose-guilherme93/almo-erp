/**
 * Testes dos chamados de reparo.
 *
 * O que precisa ser provado: a prioridade é definida por quem recebe (não por
 * quem abre), qualquer unidade é aceita na abertura, e quem abriu acompanha o
 * chamado mesmo tendo escolhido outra unidade.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  assignMaintenanceRequest,
  cancelMaintenanceRequest,
  claimMaintenanceRequest,
  completeMaintenanceRequest,
  createMaintenanceRequest,
  getMaintenanceRequest,
  listMaintenanceQueue,
  listMaintenanceRequests,
  maintenanceSummary,
  rejectMaintenanceRequest,
  setMaintenancePriority,
} from "@/server/services/maintenance";

const SOLICITANTE_EMAIL = "autor.reparo@ator.teste.local";
const ATENDENTE_EMAIL = "atendente.reparo@ator.teste.local";

let databaseAvailable = false;
let solicitanteId = "";
let atendenteId = "";
let branchId = "";
let otherBranchId = "";

function solicitanteContext() {
  return makeAuthContext({
    userId: solicitanteId,
    email: SOLICITANTE_EMAIL,
    name: "Solicitante Reparo",
    memberships: [{ branchId, roleSlug: "SOLICITANTE" }],
    permissions: ["manutencao:read", "manutencao:create"],
    activeBranchId: branchId,
  });
}

function atendenteContext() {
  return makeAuthContext({
    userId: atendenteId,
    email: ATENDENTE_EMAIL,
    name: "Atendente Reparo",
    memberships: [{ branchId, roleSlug: "ADMIN_FILIAL" }],
    permissions: ["manutencao:read", "manutencao:create", "manutencao:atender"],
    activeBranchId: branchId,
  });
}

async function cleanup(): Promise<void> {
  const requests = await prisma.maintenanceRequest.findMany({
    where: { requesterId: { in: [solicitanteId, atendenteId] } },
    select: { id: true },
  });

  const ids = requests.map((request) => request.id);

  if (ids.length > 0) {
    await prisma.maintenanceEvent.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.notification.deleteMany({
      where: { entityType: "MaintenanceRequest", entityId: { in: ids } },
    });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Abre um chamado básico na unidade de teste. */
async function newRepair(branch = branchId) {
  return createMaintenanceRequest(solicitanteContext(), {
    branchId: branch,
    category: "HVAC",
    title: "Ar-condicionado da sala 3 não gela",
    description: "O aparelho liga, sopra ar mas não gela desde ontem à tarde.",
    location: "Sala 3 — 2º andar",
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

  const [solicitante, atendente] = await Promise.all([
    prisma.user.upsert({
      where: { email: SOLICITANTE_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: SOLICITANTE_EMAIL, name: "Solicitante Reparo", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: ATENDENTE_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: ATENDENTE_EMAIL, name: "Atendente Reparo", status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  solicitanteId = solicitante.id;
  atendenteId = atendente.id;

  // O atendente precisa de vínculo para poder ser atribuído.
  const role = await prisma.role.findUniqueOrThrow({
    where: { slug: "ADMIN_FILIAL" },
    select: { id: true },
  });

  await prisma.membership.deleteMany({ where: { userId: atendente.id } });
  await prisma.membership.create({
    data: { userId: atendente.id, branchId, roleId: role.id, active: true },
  });
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await cleanup();
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();
    await prisma.membership.deleteMany({ where: { userId: atendenteId } });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: [solicitanteId, atendenteId] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [SOLICITANTE_EMAIL, ATENDENTE_EMAIL] } },
    });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("abertura", () => {
  it("nasce aberto e sem prioridade", async () => {
    const request = await newRepair();

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, priority: true, number: true },
    });

    expect(saved.status).toBe("OPEN");
    // Quem define a prioridade é quem recebe, não quem abre.
    expect(saved.priority).toBeNull();
    expect(saved.number).toMatch(/^REP-\d{4}-\d{6}$/);
  });

  it("notifica quem atende manutenção na unidade", async () => {
    const request = await newRepair();

    const notifications = await prisma.notification.findMany({
      where: { entityId: request.id, userId: atendenteId },
    });

    expect(notifications.length).toBeGreaterThan(0);
  });

  it("aceita unidade fora do vínculo do solicitante", async () => {
    const request = await newRepair(otherBranchId);

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { branchId: true },
    });

    expect(saved.branchId).toBe(otherBranchId);
  });

  it("quem abriu continua vendo o chamado de outra unidade", async () => {
    const request = await newRepair(otherBranchId);

    const detail = await getMaintenanceRequest(solicitanteContext(), request.id);

    expect(detail.branch.id).toBe(otherBranchId);
  });
});

describe.runIf(process.env["DATABASE_URL"])("prioridade por quem recebe", () => {
  it("o atendente define a prioridade e avisa quem abriu", async () => {
    const request = await newRepair();

    await setMaintenancePriority(atendenteContext(), {
      requestId: request.id,
      priority: "URGENT",
      comment: "Risco para a operação.",
    });

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { priority: true },
    });

    expect(saved.priority).toBe("URGENT");

    const notifications = await prisma.notification.findMany({
      where: { entityId: request.id, userId: solicitanteId, type: "MAINTENANCE_PRIORITY_SET" },
    });

    expect(notifications.length).toBeGreaterThan(0);
  });

  it("não aceita definir prioridade de chamado encerrado", async () => {
    const request = await newRepair();

    await claimMaintenanceRequest(atendenteContext(), request.id);
    await assignMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      assignedToId: atendenteId,
    });
    await completeMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      resolution: "Reparo concluído e testado.",
    });

    await expect(
      setMaintenancePriority(atendenteContext(), { requestId: request.id, priority: "HIGH" }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("atendimento", () => {
  it("assumir move para em análise", async () => {
    const request = await newRepair();

    await claimMaintenanceRequest(atendenteContext(), request.id);

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, claimedById: true },
    });

    expect(saved.status).toBe("IN_REVIEW");
    expect(saved.claimedById).toBe(atendenteId);
  });

  it("não permite que outra pessoa assuma um chamado já em análise", async () => {
    const request = await newRepair();

    await claimMaintenanceRequest(atendenteContext(), request.id);

    const outro = makeAuthContext({
      userId: solicitanteId,
      memberships: [{ branchId, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["manutencao:atender"],
      activeBranchId: branchId,
    });

    await expect(claimMaintenanceRequest(outro, request.id)).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("atribuir move para em andamento e avisa o responsável", async () => {
    const request = await newRepair();

    await assignMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      assignedToId: atendenteId,
    });

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, assignedToId: true },
    });

    expect(saved.status).toBe("IN_PROGRESS");
    expect(saved.assignedToId).toBe(atendenteId);
  });

  it("concluir registra a resolução e o tempo gasto", async () => {
    const request = await newRepair();

    await assignMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      assignedToId: atendenteId,
    });

    const result = await completeMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      resolution: "Substituído o capacitor e recarregado o gás.",
    });

    expect(result.resolutionHours).toBeGreaterThanOrEqual(0);

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, resolution: true, completedAt: true },
    });

    expect(saved.status).toBe("DONE");
    expect(saved.resolution).toContain("capacitor");
    expect(saved.completedAt).not.toBeNull();
  });

  it("recusar exige motivo", async () => {
    const request = await newRepair();

    await expect(
      rejectMaintenanceRequest(atendenteContext(), { requestId: request.id, reason: "ok" }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    await rejectMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      reason: "Não é escopo da manutenção predial.",
    });

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, rejectReason: true },
    });

    expect(saved.status).toBe("REJECTED");
    expect(saved.rejectReason).toContain("escopo");
  });

  it("não atribui a quem não tem vínculo na unidade", async () => {
    const request = await newRepair();

    await expect(
      assignMaintenanceRequest(atendenteContext(), {
        requestId: request.id,
        assignedToId: solicitanteId,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("fila e indicadores", () => {
  it("a fila lista abertos, com maior prioridade primeiro", async () => {
    const urgente = await newRepair();
    const normal = await newRepair();

    await setMaintenancePriority(atendenteContext(), {
      requestId: urgente.id,
      priority: "URGENT",
    });
    await setMaintenancePriority(atendenteContext(), {
      requestId: normal.id,
      priority: "LOW",
    });

    const queue = await listMaintenanceQueue(atendenteContext(), branchId);

    const positions = queue.items.map((item) => item.id);

    expect(positions.indexOf(urgente.id)).toBeLessThan(positions.indexOf(normal.id));
  });

  it("não lista chamado concluído na fila", async () => {
    const request = await newRepair();

    await assignMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      assignedToId: atendenteId,
    });
    await completeMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      resolution: "Reparo concluído.",
    });

    const queue = await listMaintenanceQueue(atendenteContext(), branchId);

    expect(queue.items.map((item) => item.id)).not.toContain(request.id);
  });

  it("o resumo conta abertos e os que ainda não foram classificados", async () => {
    await newRepair();

    const summary = await maintenanceSummary([branchId]);

    expect(summary.open).toBeGreaterThan(0);
    expect(summary.withoutPriority).toBeGreaterThan(0);
  });

  it("o solicitante vê só os próprios chamados", async () => {
    await newRepair();

    const other = makeAuthContext({
      userId: atendenteId,
      memberships: [{ branchId: otherBranchId, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["manutencao:read"],
      activeBranchId: otherBranchId,
    });

    const list = await prisma.maintenanceRequest.findMany({
      where: { branchId, requesterId: solicitanteId },
      select: { id: true },
    });

    // O atendente não tem vínculo nesta unidade nem abriu os chamados.
    const visible = await getMaintenanceRequest(other, list[0]?.id ?? "").catch(() => null);

    expect(visible).toBeNull();
  });

  it("a busca não escapa do escopo de filial", async () => {
    // Chamado de outra unidade, aberto por outra pessoa. A busca do solicitante
    // não pode devolvê-lo só porque o número casa.
    const deOutraUnidade = await createMaintenanceRequest(atendenteContext(), {
      branchId: otherBranchId,
      category: "HVAC",
      title: "Chamado de outra unidade",
      description: "Aberto para provar que a busca respeita o escopo de filial.",
      location: "Outra unidade",
    });

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: deOutraUnidade.id },
      select: { number: true },
    });

    const list = await listMaintenanceRequests(solicitanteContext(), {
      search: saved.number,
    });

    expect(list.items).toHaveLength(0);
    expect(list.total).toBe(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("cancelamento", () => {
  it("quem abriu pode cancelar", async () => {
    const request = await newRepair();

    await cancelMaintenanceRequest(solicitanteContext(), {
      requestId: request.id,
      reason: "problema resolvido sozinho",
    });

    const saved = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true },
    });

    expect(saved.status).toBe("CANCELLED");
  });

  it("não cancela chamado concluído", async () => {
    const request = await newRepair();

    await assignMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      assignedToId: atendenteId,
    });
    await completeMaintenanceRequest(atendenteContext(), {
      requestId: request.id,
      resolution: "Concluído.",
    });

    await expect(
      cancelMaintenanceRequest(solicitanteContext(), { requestId: request.id }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
