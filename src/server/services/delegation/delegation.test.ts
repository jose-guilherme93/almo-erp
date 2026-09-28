/**
 * Testes do encaminhamento de etapa entre setores.
 *
 * O que precisa ser provado: a demanda só aparece para o setor de destino
 * enquanto a etapa existe; quem atende é o setor de destino; concluir exige
 * laudo; e o setor de origem retoma a demanda depois.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  acceptDelegation,
  completeDelegation,
  createDelegation,
  getDelegation,
  listDelegations,
  returnDelegation,
} from "@/server/services/delegation";
import { createMaintenanceRequest, listMaintenanceRequests } from "@/server/services/maintenance";

const AUTOR_EMAIL = "autor.encaminhamento@ator.teste.local";
const TI_EMAIL = "tecnico.encaminhamento@ator.teste.local";
const ALMOX_EMAIL = "almox.encaminhamento@ator.teste.local";

let databaseAvailable = false;
let autorId = "";
let tiId = "";
let almoxId = "";
let branchId = "";
let tiSectorId = "";
let almoxSectorId = "";

function autorContext() {
  return makeAuthContext({
    userId: autorId,
    name: "Autor",
    memberships: [{ branchId, roleSlug: "SOLICITANTE" }],
    permissions: ["manutencao:read", "manutencao:create"],
    activeBranchId: branchId,
    // Setor fictício só para provar que um setor sem etapa não enxerga nada.
    sectorIds: ["pedagogico"],
  });
}

function almoxContext() {
  return makeAuthContext({
    userId: almoxId,
    name: "Almoxarife",
    memberships: [{ branchId, roleSlug: "ALMOXARIFE", sectorId: almoxSectorId }],
    permissions: ["manutencao:read", "manutencao:delegar", "manutencao:atender"],
    activeBranchId: branchId,
  });
}

function tiContext() {
  return makeAuthContext({
    userId: tiId,
    name: "Técnico TI",
    memberships: [{ branchId, roleSlug: "TI", sectorId: tiSectorId }],
    permissions: ["manutencao:read", "manutencao:atender", "manutencao:delegar"],
    activeBranchId: branchId,
  });
}

async function cleanup(): Promise<void> {
  const tickets = await prisma.maintenanceRequest.findMany({
    where: { requesterId: autorId },
    select: { id: true },
  });

  const ticketIds = tickets.map((ticket) => ticket.id);

  const delegations = await prisma.delegation.findMany({
    where: { OR: [{ maintenanceRequestId: { in: ticketIds } }, { requestedById: almoxId }] },
    select: { id: true },
  });

  const delegationIds = delegations.map((delegation) => delegation.id);

  if (delegationIds.length > 0) {
    await prisma.delegationEvent.deleteMany({
      where: { delegationId: { in: delegationIds } },
    });
    await prisma.notification.deleteMany({
      where: { entityType: "Delegation", entityId: { in: delegationIds } },
    });
    await prisma.delegation.deleteMany({ where: { id: { in: delegationIds } } });
  }

  if (ticketIds.length > 0) {
    await prisma.maintenanceEvent.deleteMany({ where: { requestId: { in: ticketIds } } });
    await prisma.notification.deleteMany({
      where: { entityType: "MaintenanceRequest", entityId: { in: ticketIds } },
    });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: ticketIds } } });
  }
}

async function newRepair() {
  return createMaintenanceRequest(autorContext(), {
    branchId,
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

  const [branch, tiSector, almoxSector] = await Promise.all([
    prisma.branch.findFirst({ where: { active: true }, select: { id: true } }),
    prisma.sector.findUnique({ where: { code: "TI" }, select: { id: true } }),
    prisma.sector.findUnique({ where: { code: "ALMOXARIFADO" }, select: { id: true } }),
  ]);

  if (!branch || !tiSector || !almoxSector) {
    databaseAvailable = false;
    return;
  }

  branchId = branch.id;
  tiSectorId = tiSector.id;
  almoxSectorId = almoxSector.id;

  const [autor, ti, almox] = await Promise.all([
    prisma.user.upsert({
      where: { email: AUTOR_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: AUTOR_EMAIL, name: "Autor", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: TI_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: TI_EMAIL, name: "Técnico TI", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: ALMOX_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: ALMOX_EMAIL, name: "Almoxarife", status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  autorId = autor.id;
  tiId = ti.id;
  almoxId = almox.id;

  const [tiRole, almoxRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { slug: "TI" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { slug: "ALMOXARIFE" }, select: { id: true } }),
  ]);

  await prisma.membership.deleteMany({ where: { userId: { in: [tiId, almoxId, autorId] } } });
  await prisma.membership.createMany({
    data: [
      { userId: tiId, branchId, roleId: tiRole.id, sectorId: tiSectorId, active: true },
      { userId: almoxId, branchId, roleId: almoxRole.id, sectorId: almoxSectorId, active: true },
    ],
  });
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await cleanup();
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();
    await prisma.membership.deleteMany({ where: { userId: { in: [tiId, almoxId, autorId] } } });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: [tiId, almoxId, autorId] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [AUTOR_EMAIL, TI_EMAIL, ALMOX_EMAIL] } },
    });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("encaminhamento de etapa", () => {
  it("o almoxarifado encaminha uma etapa e a TI é notificada", async () => {
    const request = await newRepair();

    const { delegationId } = await createDelegation(almoxContext(), {
      entityType: "MAINTENANCE",
      entityId: request.id,
      toSectorId: tiSectorId,
      reason: "Analisar se o defeito é de fabricação ou mau uso.",
    });

    const saved = await prisma.delegation.findUniqueOrThrow({
      where: { id: delegationId },
      select: { status: true, fromSectorId: true, toSectorId: true },
    });

    expect(saved.status).toBe("PENDING");
    expect(saved.toSectorId).toBe(tiSectorId);

    const notifications = await prisma.notification.findMany({
      where: { entityType: "Delegation", entityId: delegationId, userId: tiId },
    });

    expect(notifications.length).toBeGreaterThan(0);
  });

  it("a TI só enxerga o chamado porque a etapa foi encaminhada", async () => {
    const request = await newRepair();

    const before = await listMaintenanceRequests(tiContext(), {});
    expect(before.items.map((item) => item.id)).not.toContain(request.id);

    await createDelegation(almoxContext(), {
      entityType: "MAINTENANCE",
      entityId: request.id,
      toSectorId: tiSectorId,
      reason: "Verificar a placa de rede.",
    });

    const after = await listMaintenanceRequests(tiContext(), {});
    expect(after.items.map((item) => item.id)).toContain(request.id);
  });

  it("só o setor de destino aceita e conclui; concluir exige laudo", async () => {
    const request = await newRepair();

    const { delegationId } = await createDelegation(almoxContext(), {
      entityType: "MAINTENANCE",
      entityId: request.id,
      toSectorId: tiSectorId,
      reason: "Análise técnica.",
    });

    await expect(acceptDelegation(almoxContext(), delegationId)).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });

    await acceptDelegation(tiContext(), delegationId);

    await expect(
      completeDelegation(tiContext(), { delegationId, report: "ok" }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    await completeDelegation(tiContext(), {
      delegationId,
      report: "Necessária a troca da placa-mãe; defeito não é mau uso.",
    });

    const saved = await prisma.delegation.findUniqueOrThrow({
      where: { id: delegationId },
      select: { status: true, report: true },
    });

    expect(saved.status).toBe("COMPLETED");
    expect(saved.report).toContain("placa-mãe");
  });

  it("o setor de origem retoma a demanda ao encerrar a etapa", async () => {
    const request = await newRepair();

    const { delegationId } = await createDelegation(almoxContext(), {
      entityType: "MAINTENANCE",
      entityId: request.id,
      toSectorId: tiSectorId,
      reason: "Análise técnica.",
    });

    // A TI não pode devolver uma etapa que é dela mesma.
    await expect(returnDelegation(tiContext(), { delegationId })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });

    await completeDelegation(tiContext(), {
      delegationId,
      report: "Defeito de fabricação confirmado.",
    });

    const result = await returnDelegation(almoxContext(), { delegationId });

    expect(result.status).toBe("RETURNED");
  });

  it("a caixa do setor lista as etapas endereçadas a ele", async () => {
    const request = await newRepair();

    await createDelegation(almoxContext(), {
      entityType: "MAINTENANCE",
      entityId: request.id,
      toSectorId: tiSectorId,
      reason: "Análise técnica.",
    });

    const inbox = await listDelegations(tiContext(), { forMySector: true });

    expect(inbox.items.length).toBeGreaterThan(0);

    // Quem não é do setor, não abriu a demanda e não tem visão geral não abre a etapa.
    const outsider = makeAuthContext({
      userId: "outsider-sem-setor",
      memberships: [{ branchId, roleSlug: "CONSULTA" }],
      permissions: ["manutencao:read"],
      activeBranchId: branchId,
      sectorIds: ["setor-que-nao-participa"],
    });

    await expect(getDelegation(outsider, inbox.items[0]?.id ?? "")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("quem abriu a demanda acompanha as etapas dela", async () => {
    const request = await newRepair();

    const { delegationId } = await createDelegation(almoxContext(), {
      entityType: "MAINTENANCE",
      entityId: request.id,
      toSectorId: tiSectorId,
      reason: "Análise técnica.",
    });

    const detail = await getDelegation(autorContext(), delegationId);

    expect(detail.status).toBe("PENDING");
    expect(detail.toSector.name).toBeTruthy();
  });
});
