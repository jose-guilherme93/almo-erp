/**
 * Testes de integração do serviço de usuários.
 *
 * Cobrem o que a FASE 03 exige provar: escopo por filial e a trava contra
 * perda do último super administrador (lockout do sistema).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  changeUserStatus,
  createUser,
  getUserDetail,
  listUsers,
  removeMembership,
} from "@/server/services/user";

const TEST_DOMAIN = "usuarios.teste.local";
// O autor vive em outro domínio para não ser atingido pela limpeza entre testes.
const ACTOR_EMAIL = "autor@ator.teste.local";

let databaseAvailable = false;
let branchA = "";
let branchB = "";
let roleId = "";
let superAdminRoleId = "";
let allBranchIds: string[] = [];
/** Usuário real no banco que atua como autor das ações. */
let actorId = "";

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${TEST_DOMAIN}` } },
    select: { id: true },
  });

  const ids = users.map((user) => user.id);

  if (ids.length > 0) {
    await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.invite.deleteMany({ where: { email: { endsWith: `@${TEST_DOMAIN}` } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
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
    orderBy: { code: "asc" },
    take: 2,
    select: { id: true },
  });

  const gestor = await prisma.role.findUnique({
    where: { slug: "GESTOR" },
    select: { id: true },
  });

  const superAdmin = await prisma.role.findUnique({
    where: { slug: "SUPER_ADMIN" },
    select: { id: true },
  });

  if (branches.length < 2 || !gestor || !superAdmin) {
    databaseAvailable = false;
    return;
  }

  branchA = branches[0]?.id ?? "";
  branchB = branches[1]?.id ?? "";
  roleId = gestor.id;
  superAdminRoleId = superAdmin.id;

  const allBranches = await prisma.branch.findMany({
    where: { active: true },
    select: { id: true },
  });
  allBranchIds = allBranches.map((branch) => branch.id);

  // O autor precisa existir de verdade: `invitedById` tem chave estrangeira.
  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor dos Testes", status: "ACTIVE" },
    select: { id: true },
  });

  actorId = actor.id;

  // O domínio dos testes precisa estar autorizado: o serviço recusa criar
  // usuário fora de um domínio corporativo permitido.
  await prisma.emailPolicy.upsert({
    where: { domain: TEST_DOMAIN },
    update: { active: true, autoApprove: false },
    create: { domain: TEST_DOMAIN, autoApprove: false, active: true },
  });
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await cleanup();
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    const actor = await prisma.user.findUnique({
      where: { email: ACTOR_EMAIL },
      select: { id: true },
    });

    if (actor) {
      await prisma.membership.deleteMany({ where: { userId: actor.id } });
      await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }

    await prisma.emailPolicy.deleteMany({ where: { domain: TEST_DOMAIN } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("escopo por filial", () => {
  it("ADMIN_FILIAL da unidade A não enxerga usuários da unidade B", async () => {
    const userB = await prisma.user.create({
      data: {
        email: `somente-b@${TEST_DOMAIN}`,
        name: "Usuário da Unidade B",
        status: "ACTIVE",
        memberships: {
          create: { branchId: branchB, roleId, active: true },
        },
      },
      select: { id: true },
    });

    const context = makeAuthContext({
      userId: actorId,
      memberships: [
        { branchId: branchA, roleSlug: "ADMIN_FILIAL", roleName: "Administrador da unidade" },
      ],
      permissions: ["usuario:read", "usuario:manage"],
    });

    const result = await listUsers(context, { pageSize: 100 });
    const ids = result.items.map((item) => item.id);

    expect(ids).not.toContain(userB.id);
  });

  it("não é possível detalhar usuário de outra filial", async () => {
    const userB = await prisma.user.create({
      data: {
        email: `detalhe-b@${TEST_DOMAIN}`,
        name: "Outro",
        status: "ACTIVE",
        memberships: { create: { branchId: branchB, roleId, active: true } },
      },
      select: { id: true },
    });

    const context = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: branchA, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["usuario:read"],
    });

    // Devolvemos "não encontrado", e não "proibido": um 403 aqui revelaria que
    // o registro existe em outra unidade.
    await expect(getUserDetail(context, userB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("não é possível criar usuário em filial fora do escopo", async () => {
    const context = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: branchA, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["usuario:manage"],
    });

    await expect(
      createUser(context, {
        name: "Fora do Escopo",
        email: `fora@${TEST_DOMAIN}`,
        roleId,
        branchIds: [branchB],
        activateNow: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const created = await prisma.user.count({
      where: { email: `fora@${TEST_DOMAIN}` },
    });

    expect(created).toBe(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("criação de usuário", () => {
  it("cria usuário PENDING com convite quando não ativa direto", async () => {
    const context = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: branchA, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["usuario:manage"],
    });

    const email = `novo@${TEST_DOMAIN}`;
    const result = await createUser(context, {
      name: "Novo Usuário",
      email,
      roleId,
      branchIds: [branchA],
      activateNow: false,
    });

    expect(result.inviteToken).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: { memberships: true },
    });

    expect(user.status).toBe("PENDING");
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]?.branchId).toBe(branchA);
    expect(user.memberships[0]?.isDefault).toBe(true);

    const invite = await prisma.invite.findFirst({ where: { email } });
    expect(invite?.status).toBe("PENDING");
  });

  it("cria usuário ACTIVE sem convite quando ativa direto", async () => {
    const context = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: branchA, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["usuario:manage"],
    });

    const email = `ativo@${TEST_DOMAIN}`;
    const result = await createUser(context, {
      name: "Usuário Ativo",
      email,
      roleId,
      branchIds: [branchA, branchB].slice(0, 1),
      activateNow: true,
    });

    expect(result.inviteToken).toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.status).toBe("ACTIVE");

    const invites = await prisma.invite.count({ where: { email } });
    expect(invites).toBe(0);
  });

  it("registra auditoria da criação", async () => {
    const context = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: branchA, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["usuario:manage"],
    });

    const result = await createUser(context, {
      name: "Auditado",
      email: `auditado@${TEST_DOMAIN}`,
      roleId,
      branchIds: [branchA],
      activateNow: false,
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: result.userId },
      orderBy: { createdAt: "desc" },
    });

    expect(log?.action).toBe("user.created");
  });

  it("recusa e-mail de domínio não autorizado", async () => {
    const context = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: branchA, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["usuario:manage"],
    });

    // Deixar cadastrar um e-mail que nunca conseguiria entrar seria uma
    // armadilha para o administrador.
    await expect(
      createUser(context, {
        name: "Pessoal",
        email: "alguem@gmail.com",
        roleId,
        branchIds: [branchA],
        activateNow: true,
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const created = await prisma.user.count({ where: { email: "alguem@gmail.com" } });
    expect(created).toBe(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("trava de lockout do super administrador", () => {
  /** Vínculos ativos de SUPER_ADMIN com usuário ativo. */
  async function activeSuperAdmins() {
    return prisma.membership.findMany({
      where: {
        active: true,
        roleId: superAdminRoleId,
        user: { status: "ACTIVE", active: true },
      },
      select: { id: true, userId: true },
    });
  }

  const networkContext = () =>
    makeAuthContext({
      userId: actorId,
      networkPermissions: ["usuario:manage"],
      networkBranchIds: allBranchIds,
    });

  it("impede remover o vínculo do último SUPER_ADMIN ativo", async () => {
    const superAdmins = await activeSuperAdmins();
    const only = superAdmins.length === 1 ? superAdmins[0] : undefined;

    if (!only) {
      // O cenário exige exatamente um super admin ativo (estado do seed).
      expect(superAdmins).toHaveLength(1);
      return;
    }

    await expect(removeMembership(networkContext(), only.id)).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });

    // A trava precisa ser atômica: nada pode ter sido removido.
    const stillExists = await prisma.membership.count({ where: { id: only.id } });
    expect(stillExists).toBe(1);
  });

  it("impede suspender o último SUPER_ADMIN ativo", async () => {
    const superAdmins = await activeSuperAdmins();
    const only = superAdmins.length === 1 ? superAdmins[0] : undefined;

    if (!only) {
      expect(superAdmins).toHaveLength(1);
      return;
    }

    await expect(
      changeUserStatus(networkContext(), { userId: only.userId, status: "SUSPENDED" }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: only.userId },
      select: { status: true },
    });

    expect(user.status).toBe("ACTIVE");
  });
});
