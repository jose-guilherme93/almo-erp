/**
 * Testes de veracidade do dashboard.
 *
 * O que precisa ser provado (AGENTS.md §7 e FASE 18): todo número do dashboard
 * tem a mesma consulta na lista para a qual aponta. Se o card diz "2 aguardando
 * decisão", a fila de aprovação precisa devolver exatamente esses 2.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { awaitingDelivery, pendingRequests, requestsAtRisk } from "@/server/services/dashboard";
import { listApprovalQueue, listPendingDeliveries } from "@/server/services/request";

const TEST_PREFIX = "DAS";
const ACTOR_EMAIL = "autor.dashboard@ator.teste.local";

let databaseAvailable = false;
let actorId = "";
let branchA = "";
let branchB = "";
let allBranches: string[] = [];

/** Contexto de escopo de rede (matriz), como o do super admin. */
function networkContext() {
  return makeAuthContext({
    userId: actorId,
    networkPermissions: [
      "solicitacao:read",
      "solicitacao:overview",
      "solicitacao:approve",
      "solicitacao:entregar",
    ],
    networkBranchIds: allBranches,
    activeBranchId: branchA,
  });
}

async function cleanup(): Promise<void> {
  const requests = await prisma.request.findMany({
    where: { number: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });

  const ids = requests.map((request) => request.id);

  if (ids.length > 0) {
    await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.requestEvent.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.request.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Cria uma solicitação direto no banco, só para exercitar contagem × lista. */
async function createRequestRow(
  status: "SUBMITTED" | "IN_REVIEW" | "APPROVED",
  branchId = branchA,
) {
  return prisma.request.create({
    data: {
      number: `${TEST_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      branchId,
      requesterId: actorId,
      status,
      neededAt: null,
    },
    select: { id: true },
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

  branchA = branches[0]?.id ?? "";
  branchB = branches[1]?.id ?? "";

  const all = await prisma.branch.findMany({ select: { id: true } });
  allBranches = all.map((branch) => branch.id);

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Dashboard", status: "ACTIVE" },
    select: { id: true },
  });

  actorId = actor.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await cleanup();
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.user.deleteMany({ where: { email: ACTOR_EMAIL } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("dashboard × lista", () => {
  it("'aguardando decisão' bate com o total da fila de aprovação", async () => {
    const context = networkContext();

    const a = await createRequestRow("SUBMITTED");
    const b = await createRequestRow("IN_REVIEW");
    await createRequestRow("SUBMITTED", branchB);

    const card = await pendingRequests(allBranches);
    const queue = await listApprovalQueue(context, null);

    expect(queue.total).toBe(card);

    const ids = queue.items.map((item) => item.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it("a fila por unidade bate com o indicador daquela unidade", async () => {
    const context = networkContext();

    await createRequestRow("SUBMITTED");

    const card = await pendingRequests([branchA]);
    const queue = await listApprovalQueue(context, branchA);

    expect(queue.total).toBe(card);
  });

  it("'prontas para entregar' bate com o total de entregas pendentes", async () => {
    const context = networkContext();

    const aprovada = await createRequestRow("APPROVED");

    const card = await awaitingDelivery(allBranches);
    const list = await listPendingDeliveries(context, null);

    expect(list.total).toBe(card);
    expect(list.items.map((item) => item.id)).toContain(aprovada.id);
  });

  it("'acima de 24h' nunca passa do total de pendentes", async () => {
    const atRisk = await requestsAtRisk(allBranches);
    const pending = await pendingRequests(allBranches);

    expect(atRisk).toBeLessThanOrEqual(pending);
  });
});
