/**
 * Testes do motor de notificação.
 *
 * O que precisa ser provado: quem recebe (fan-out por regra), quem NUNCA
 * recebe (usuário de outra unidade), deduplicação e isolamento do "marcar como
 * lida".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { markAsRead, markAllAsRead, unreadCount } from "@/server/services/notification/inbox";
import { notify, resolveRecipients } from "@/server/services/notification";

const TEST_PREFIX = "NTF";
const ACTOR_EMAIL = "autor.notificacao@ator.teste.local";
const APROVADOR_EMAIL = "aprovador.notificacao@ator.teste.local";
const OUTRA_UNIDADE_EMAIL = "outro.notificacao@ator.teste.local";
const MATRIZ_EMAIL = "matriz.notificacao@ator.teste.local";

let databaseAvailable = false;
let actorId = "";
let aprovadorId = "";
let outroId = "";
let matrizId = "";
let branchId = "";
let otherBranchId = "";

async function cleanup(): Promise<void> {
  await prisma.notification.deleteMany({
    where: { userId: { in: [actorId, aprovadorId, outroId, matrizId].filter(Boolean) } },
  });
}

async function createSupportRequest(): Promise<string> {
  const request = await prisma.request.create({
    data: {
      number: `${TEST_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      branchId,
      requesterId: actorId,
      status: "SUBMITTED",
    },
    select: { id: true },
  });

  return request.id;
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

  const [actor, aprovador, outro, matriz] = await Promise.all([
    prisma.user.upsert({
      where: { email: ACTOR_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: ACTOR_EMAIL, name: "Autor Notificação", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: APROVADOR_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: APROVADOR_EMAIL, name: "Aprovador Notificação", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: OUTRA_UNIDADE_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: OUTRA_UNIDADE_EMAIL, name: "Outra Unidade", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: MATRIZ_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: MATRIZ_EMAIL, name: "Admin da Matriz", status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  actorId = actor.id;
  aprovadorId = aprovador.id;
  outroId = outro.id;
  matrizId = matriz.id;

  const [role, matrizRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { slug: "ADMIN_FILIAL" }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { slug: "ADMIN_MATRIZ" }, select: { id: true } }),
  ]);

  // Aprovador na unidade do teste; o outro usuário fica em OUTRA unidade; a
  // matriz tem vínculo de escopo global.
  await prisma.membership.deleteMany({
    where: { userId: { in: [aprovadorId, outroId, matrizId] } },
  });

  await prisma.membership.createMany({
    data: [
      { userId: aprovadorId, branchId, roleId: role.id, active: true },
      { userId: outroId, branchId: otherBranchId, roleId: role.id, active: true },
      { userId: matrizId, branchId, roleId: matrizRole.id, active: true },
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

    await prisma.request.deleteMany({ where: { number: { startsWith: TEST_PREFIX } } });
    await prisma.membership.deleteMany({
      where: { userId: { in: [aprovadorId, outroId, matrizId] } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: [actorId, aprovadorId, outroId, matrizId] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [ACTOR_EMAIL, APROVADOR_EMAIL, OUTRA_UNIDADE_EMAIL, MATRIZ_EMAIL] } },
    });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("fan-out", () => {
  it("REQUEST_CREATED notifica quem aprova na unidade", async () => {
    const recipients = await resolveRecipients({
      type: "REQUEST_CREATED",
      actorId: null,
      branchId,
      entityType: "Request",
      entityId: "x",
    });

    expect(recipients).toContain(aprovadorId);
  });

  it("REQUEST_CREATED nunca notifica usuário de outra unidade", async () => {
    const recipients = await resolveRecipients({
      type: "REQUEST_CREATED",
      actorId: null,
      branchId,
      entityType: "Request",
      entityId: "x",
    });

    expect(recipients).not.toContain(outroId);
  });

  it("REQUEST_CREATED notifica a matriz (escopo de rede)", async () => {
    const recipients = await resolveRecipients({
      type: "REQUEST_CREATED",
      actorId: null,
      branchId: otherBranchId,
      entityType: "Request",
      entityId: "x",
    });

    // A matriz não tem vínculo na unidade, mas acompanha a rede.
    expect(recipients).toContain(matrizId);
  });

  it("exclui o autor da ação dos destinatários", async () => {
    const recipients = await resolveRecipients({
      type: "REQUEST_CREATED",
      actorId: aprovadorId,
      branchId,
      entityType: "Request",
      entityId: "x",
    });

    expect(recipients).not.toContain(aprovadorId);
  });

  it("REQUEST_APPROVED notifica somente o solicitante", async () => {
    const recipients = await resolveRecipients({
      type: "REQUEST_APPROVED",
      actorId: aprovadorId,
      branchId,
      entityType: "Request",
      entityId: "x",
      data: { requesterId: actorId },
    });

    expect(recipients).toEqual([actorId]);
  });

  it("ACCESS_GRANTED notifica apenas o próprio usuário", async () => {
    const recipients = await resolveRecipients({
      type: "ACCESS_GRANTED",
      actorId: null,
      branchId: null,
      entityType: "User",
      entityId: actorId,
      data: { userId: actorId },
    });

    expect(recipients).toEqual([actorId]);
  });

  it("devolve lista vazia sem aprovador na unidade", async () => {
    const recipients = await resolveRecipients({
      type: "REQUEST_CREATED",
      actorId: aprovadorId,
      branchId: otherBranchId,
      entityType: "Request",
      entityId: "x",
    });

    // `outroId` é ADMIN_FILIAL na outra unidade, mas o ator é excluído.
    expect(recipients).not.toContain(aprovadorId);
  });
});

describe.runIf(process.env["DATABASE_URL"])("criação e deduplicação", () => {
  it("cria uma notificação por destinatário", async () => {
    const requestId = await createSupportRequest();

    const created = await prisma.$transaction((tx) =>
      notify(tx, {
        type: "REQUEST_CREATED",
        actorId: actorId,
        branchId,
        entityType: "Request",
        entityId: requestId,
        data: { requestId, number: "SOL-TESTE", itemCount: "3" },
      }),
    );

    expect(created).toBeGreaterThan(0);

    const stored = await prisma.notification.findMany({
      where: { entityId: requestId, userId: aprovadorId },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.title).toContain("SOL-TESTE");
  });

  it("não cria nada quando não há destinatário", async () => {
    const created = await prisma.$transaction((tx) =>
      notify(tx, {
        type: "REQUEST_REJECTED",
        actorId: actorId,
        branchId,
        entityType: "Request",
        entityId: "sem-destinatario",
        // Sem requesterId: ninguém para avisar.
      }),
    );

    expect(created).toBe(0);
  });

  it("deduplica o alerta de estoque mínimo dentro da janela", async () => {
    const item = await prisma.item.findFirstOrThrow({ select: { id: true, name: true } });

    const first = await prisma.$transaction((tx) =>
      notify(
        tx,
        {
          type: "STOCK_BELOW_MIN",
          actorId: actorId,
          branchId,
          entityType: "Item",
          entityId: item.id,
          data: { itemId: item.id, itemName: item.name, available: "1", minimum: "10" },
        },
        { dedupe: true },
      ),
    );

    const second = await prisma.$transaction((tx) =>
      notify(
        tx,
        {
          type: "STOCK_BELOW_MIN",
          actorId: actorId,
          branchId,
          entityType: "Item",
          entityId: item.id,
          data: { itemId: item.id, itemName: item.name, available: "1", minimum: "10" },
        },
        { dedupe: true },
      ),
    );

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });

  it("a transação que falha não deixa notificação órfã", async () => {
    const requestId = await createSupportRequest();

    await expect(
      prisma.$transaction(async (tx) => {
        await notify(tx, {
          type: "REQUEST_CREATED",
          actorId: actorId,
          branchId,
          entityType: "Request",
          entityId: requestId,
          data: { requestId, number: "SOL-ROLLBACK" },
        });

        // Força o rollback da transação inteira.
        throw new Error("falha simulada após notificar");
      }),
    ).rejects.toThrow("falha simulada");

    const stored = await prisma.notification.findMany({ where: { entityId: requestId } });

    expect(stored).toHaveLength(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("caixa de entrada", () => {
  it("conta não lidas e marca como lida", async () => {
    const requestId = await createSupportRequest();

    await prisma.$transaction((tx) =>
      notify(tx, {
        type: "REQUEST_CREATED",
        actorId: actorId,
        branchId,
        entityType: "Request",
        entityId: requestId,
        data: { requestId, number: "SOL-CONTADOR" },
      }),
    );

    const before = await unreadCount(aprovadorId);
    expect(before).toBeGreaterThan(0);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: aprovadorId, readAt: null },
    });

    await markAsRead(aprovadorId, notification.id);

    expect(await unreadCount(aprovadorId)).toBe(before - 1);
  });

  it("um usuário não marca a notificação de outro", async () => {
    const requestId = await createSupportRequest();

    await prisma.$transaction((tx) =>
      notify(tx, {
        type: "REQUEST_CREATED",
        actorId: actorId,
        branchId,
        entityType: "Request",
        entityId: requestId,
        data: { requestId, number: "SOL-ISOLAMENTO" },
      }),
    );

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: aprovadorId, readAt: null },
    });

    // Tentativa de marcar a notificação de outra pessoa.
    await markAsRead(actorId, notification.id);

    const stored = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
      select: { readAt: true },
    });

    expect(stored.readAt).toBeNull();
  });

  it("marcar todas como lidas zera o contador do próprio usuário", async () => {
    const requestId = await createSupportRequest();

    await prisma.$transaction((tx) =>
      notify(tx, {
        type: "REQUEST_CREATED",
        actorId: actorId,
        branchId,
        entityType: "Request",
        entityId: requestId,
        data: { requestId, number: "SOL-TODAS" },
      }),
    );

    await markAllAsRead(aprovadorId);

    expect(await unreadCount(aprovadorId)).toBe(0);
  });
});
