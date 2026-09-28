import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { isPermissionKey } from "@/lib/permissions/catalog";
import type { CreateRoleInput, UpdateRoleInput } from "@/lib/validation/user";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";

/** Serviço de papéis. Papéis são dados: criar/editar não exige deploy. */

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      scope: true,
      isSystem: true,
      active: true,
      _count: { select: { memberships: true, rolePermissions: true } },
    },
  });

  return roles;
}

export async function getRole(roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      scope: true,
      isSystem: true,
      active: true,
      rolePermissions: { select: { permissionId: true } },
      _count: { select: { memberships: true } },
    },
  });

  if (!role) {
    throw new NotFoundError("Perfil");
  }

  return {
    ...role,
    permissionKeys: role.rolePermissions.map((entry) => entry.permissionId),
  };
}

/** Valida a lista de permissões recebida do formulário. */
function sanitizePermissions(permissions: string[]): string[] {
  const unique = [...new Set(permissions)];
  const invalid = unique.filter((permission) => !isPermissionKey(permission));

  if (invalid.length > 0) {
    throw new ConflictError(`Permissões desconhecidas: ${invalid.join(", ")}.`);
  }

  return unique;
}

export async function createRole(
  context: AuthContext,
  input: CreateRoleInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const slug = slugify(input.name);

  if (slug.length < 3) {
    throw new ConflictError("O nome do perfil precisa ter ao menos 3 letras.");
  }

  const existing = await prisma.role.findUnique({ where: { slug }, select: { id: true } });

  if (existing) {
    throw new ConflictError("Já existe um perfil com esse nome.");
  }

  const permissions = sanitizePermissions(input.permissions);

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        slug,
        name: input.name,
        description: input.description,
        scope: input.scope,
        isSystem: false,
        active: true,
      },
      select: { id: true, slug: true },
    });

    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "role.created",
        entityType: "Role",
        entityId: role.id,
        after: { name: input.name, slug, scope: input.scope, permissions },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return role;
  });
}

export async function updateRole(
  context: AuthContext,
  input: UpdateRoleInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getRole(input.roleId);

  const permissions = sanitizePermissions(input.permissions);

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.update({
      where: { id: input.roleId },
      data: {
        name: input.name,
        description: input.description,
        // `scope` de papel de sistema não muda: quebraria o modelo mental
        // de "papel da rede" vs "papel da unidade".
        ...(current.isSystem ? {} : { scope: input.scope }),
      },
      select: { id: true },
    });

    await tx.rolePermission.deleteMany({
      where: { roleId: input.roleId, permissionId: { notIn: permissions } },
    });

    await tx.rolePermission.createMany({
      data: permissions.map((permissionId) => ({ roleId: input.roleId, permissionId })),
      skipDuplicates: true,
    });

    const added = permissions.filter((key) => !current.permissionKeys.includes(key));
    const removed = current.permissionKeys.filter((key) => !permissions.includes(key));

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "role.updated",
        entityType: "Role",
        entityId: input.roleId,
        before: { name: current.name, scope: current.scope, permissions: current.permissionKeys },
        after: { name: input.name, permissions, added, removed },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return role;
  });
}

export async function deactivateRole(
  context: AuthContext,
  roleId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const role = await getRole(roleId);

  if (role.isSystem) {
    throw new BusinessRuleError("Perfis de sistema não podem ser desativados.");
  }

  if (role._count.memberships > 0) {
    throw new BusinessRuleError(
      `Este perfil está em uso por ${role._count.memberships} vínculo(s). Troque o perfil desses usuários antes de desativar.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.role.update({ where: { id: roleId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "role.deactivated",
        entityType: "Role",
        entityId: roleId,
        before: { active: true },
        after: { active: false },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}
