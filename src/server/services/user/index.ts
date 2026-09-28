import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { evaluateCorporateEmail } from "@/lib/email-policy";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import type { CreateUserInput, UpdateUserInput } from "@/lib/validation/user";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, branchFilter, visibleBranchIds } from "@/server/auth/scope";

/**
 * Serviço de usuários, vínculos e convites.
 *
 * Regra transversal: toda função recebe o `AuthContext` e aplica o escopo por
 * filial. Um `ADMIN_FILIAL` nunca enxerga nem altera usuário de outra unidade.
 */

const INVITE_TTL_DAYS = 7;

function isNetworkScope(context: AuthContext): boolean {
  return context.isNetworkScope;
}

/**
 * Filtro de visibilidade de usuários.
 *
 * - rede: todos, ou filtrado pelas filiais pedidas
 * - filial: apenas quem tem vínculo ativo em alguma das suas filiais
 */
function userVisibilityFilter(
  context: AuthContext,
  options?: { branchId?: string | null },
): Prisma.UserWhereInput {
  const branchIds = options?.branchId
    ? ((): string[] => {
        assertBranchAccess(context, options.branchId as string);
        return [options.branchId as string];
      })()
    : visibleBranchIds(context);

  return {
    memberships: {
      some: { active: true, branchId: { in: branchIds } },
    },
  };
}

export type UserListFilters = {
  search?: string;
  branchId?: string | null;
  roleId?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listUsers(context: AuthContext, filters: UserListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.UserWhereInput = {
    ...userVisibilityFilter(context, { branchId: filters.branchId ?? null }),
    ...(filters.status ? { status: filters.status as Prisma.EnumUserStatusFilter["equals"] } : {}),
    ...(filters.roleId
      ? {
          memberships: {
            some: {
              active: true,
              roleId: filters.roleId,
              branchId: { in: visibleBranchIds(context) },
            },
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { email: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        active: true,
        lastLoginAt: true,
        memberships: {
          where: { active: true, branchId: { in: visibleBranchIds(context) } },
          select: {
            branch: { select: { id: true, code: true, name: true, type: true } },
            role: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getUserDetail(context: AuthContext, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...userVisibilityFilter(context) },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      active: true,
      avatarUrl: true,
      lastLoginAt: true,
      approvedAt: true,
      createdAt: true,
      approvedBy: { select: { id: true, name: true } },
      memberships: {
        where: { branchId: { in: visibleBranchIds(context) } },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          active: true,
          isDefault: true,
          branch: { select: { id: true, code: true, name: true, type: true, active: true } },
          role: { select: { id: true, slug: true, name: true, scope: true } },
        },
      },
      invitesSent: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          email: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          branch: { select: { code: true, name: true } },
          role: { select: { name: true } },
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError("Usuário");
  }

  return user;
}

/** Conta vínculos ativos de SUPER_ADMIN para impedir lockout do sistema. */
async function countActiveSuperAdmins(tx?: Prisma.TransactionClient): Promise<number> {
  const client = tx ?? prisma;

  return client.membership.count({
    where: {
      active: true,
      role: { slug: "SUPER_ADMIN" },
      user: { status: "ACTIVE", active: true },
    },
  });
}

async function assertNotLastSuperAdmin(
  affectedUserId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;

  const isSuperAdmin = await client.membership.count({
    where: { userId: affectedUserId, active: true, role: { slug: "SUPER_ADMIN" } },
  });

  if (isSuperAdmin === 0) return;

  const total = await countActiveSuperAdmins(tx);

  if (total <= 1) {
    throw new BusinessRuleError(
      "Este é o último super administrador ativo. Promova outro usuário antes de alterar este acesso.",
    );
  }
}

export async function createUser(
  context: AuthContext,
  input: CreateUserInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  for (const branchId of input.branchIds) {
    assertBranchAccess(context, branchId);
  }

  // O domínio precisa ser corporativo autorizado. Validar aqui evita criar um
  // usuário que nunca conseguirá entrar (a FASE 02 barraria no login).
  const policies = await prisma.emailPolicy.findMany({
    where: { active: true },
    select: { domain: true, pattern: true, autoApprove: true, active: true },
  });

  const evaluation = evaluateCorporateEmail(input.email, env.AUTH_ALLOWED_DOMAINS, policies);

  if (!evaluation.allowed) {
    throw new BusinessRuleError(
      evaluation.reason === "domain-not-allowed"
        ? "Este e-mail não é de um domínio corporativo autorizado. Cadastre a política do domínio ou use um e-mail da empresa."
        : "Este e-mail não atende à regra de acesso configurada para o domínio.",
    );
  }

  const role = await prisma.role.findUnique({
    where: { id: input.roleId },
    select: { id: true, slug: true, scope: true, active: true },
  });

  if (!role || !role.active) {
    throw new NotFoundError("Perfil");
  }

  // Um perfil de escopo global em uma filial específica seria confuso:
  // ele já vale em todas. Exigimos a matriz nesse caso.
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, status: true },
  });

  if (existing && !isNetworkScope(context)) {
    throw new ConflictError("Já existe um usuário com este e-mail.");
  }

  if (existing && existing.status === "ACTIVE") {
    throw new ConflictError("Este e-mail já tem acesso ativo. Edite o usuário existente.");
  }

  return prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            status: input.activateNow ? "ACTIVE" : "PENDING",
            active: true,
            ...(input.activateNow ? { approvedById: context.user.id, approvedAt: new Date() } : {}),
          },
        })
      : await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            status: input.activateNow ? "ACTIVE" : "PENDING",
            ...(input.activateNow ? { approvedById: context.user.id, approvedAt: new Date() } : {}),
          },
        });

    for (const [index, branchId] of input.branchIds.entries()) {
      await tx.membership.upsert({
        where: {
          userId_branchId_roleId: { userId: user.id, branchId, roleId: role.id },
        },
        update: { active: true },
        create: {
          userId: user.id,
          branchId,
          roleId: role.id,
          active: true,
          isDefault: index === 0,
        },
      });
    }

    // Sem acesso imediato, o usuário entra por convite: é o login dele que
    // vai ativar a conta (FASE 02).
    let inviteToken: string | null = null;

    if (!input.activateNow) {
      inviteToken = crypto.randomUUID();

      await tx.invite.create({
        data: {
          email: user.email,
          token: inviteToken,
          roleId: role.id,
          branchId: input.branchIds[0] as string,
          invitedById: context.user.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
          status: "PENDING",
        },
      });
    }

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: existing ? "user.reinvited" : "user.created",
        entityType: "User",
        entityId: user.id,
        branchId: input.branchIds[0] ?? null,
        after: {
          email: user.email,
          name: user.name,
          status: user.status,
          roleId: role.id,
          branchIds: input.branchIds,
        },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { userId: user.id, inviteToken };
  });
}

export async function updateUser(
  context: AuthContext,
  input: UpdateUserInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getUserDetail(context, input.userId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { name: input.name, active: input.active },
      select: { id: true, name: true, active: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "user.updated",
        entityType: "User",
        entityId: input.userId,
        before: { name: current.name, active: current.active },
        after: { name: updated.name, active: updated.active },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return updated;
  });
}

export async function changeUserStatus(
  context: AuthContext,
  input: {
    userId: string;
    status: "PENDING" | "ACTIVE" | "SUSPENDED" | "INACTIVE";
    reason?: string;
  },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getUserDetail(context, input.userId);

  // Suspender ou inativar quem é o último super admin ativo trava o sistema.
  if (input.status === "SUSPENDED" || input.status === "INACTIVE") {
    await assertNotLastSuperAdmin(input.userId);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: {
        status: input.status,
        ...(input.status === "ACTIVE"
          ? { approvedById: context.user.id, approvedAt: new Date() }
          : {}),
      },
      select: { id: true, status: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "user.status_changed",
        entityType: "User",
        entityId: input.userId,
        before: { status: current.status },
        after: { status: updated.status, reason: input.reason ?? null },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return updated;
  });
}

export async function addMembership(
  context: AuthContext,
  input: { userId: string; branchId: string; roleId: string; isDefault: boolean },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  assertBranchAccess(context, input.branchId);
  await getUserDetail(context, input.userId);

  const role = await prisma.role.findUnique({
    where: { id: input.roleId },
    select: { id: true, active: true },
  });

  if (!role || !role.active) {
    throw new NotFoundError("Perfil");
  }

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.membership.updateMany({
        where: { userId: input.userId },
        data: { isDefault: false },
      });
    }

    const membership = await tx.membership.upsert({
      where: {
        userId_branchId_roleId: {
          userId: input.userId,
          branchId: input.branchId,
          roleId: input.roleId,
        },
      },
      update: { active: true, isDefault: input.isDefault },
      create: {
        userId: input.userId,
        branchId: input.branchId,
        roleId: input.roleId,
        isDefault: input.isDefault,
        active: true,
      },
      select: { id: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "membership.added",
        entityType: "Membership",
        entityId: membership.id,
        branchId: input.branchId,
        after: { userId: input.userId, roleId: input.roleId, isDefault: input.isDefault },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return membership;
  });
}

export async function removeMembership(
  context: AuthContext,
  membershipId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      userId: true,
      branchId: true,
      roleId: true,
      role: { select: { slug: true } },
    },
  });

  if (!membership) {
    throw new NotFoundError("Vínculo");
  }

  assertBranchAccess(context, membership.branchId);
  await getUserDetail(context, membership.userId);

  if (membership.role.slug === "SUPER_ADMIN") {
    await assertNotLastSuperAdmin(membership.userId);
  }

  return prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: membershipId } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "membership.removed",
        entityType: "Membership",
        entityId: membershipId,
        branchId: membership.branchId,
        before: { userId: membership.userId, roleId: membership.roleId },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/** Usuários com uma permissão específica em uma filial (usado por notificações). */
export async function usersWithPermission(branchId: string, permission: string): Promise<string[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      branchId,
      active: true,
      user: { status: "ACTIVE", active: true },
      role: { active: true, rolePermissions: { some: { permissionId: permission } } },
    },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });

  return [...new Set(memberships.map((membership) => membership.userId))];
}

export { branchFilter, userVisibilityFilter };
