import { cache } from "react";
import { cookies } from "next/headers";

import type { BranchType, RoleScope, UserStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { auth } from "@/server/auth";

export const ACTIVE_BRANCH_COOKIE = "almo.branch";

export type BranchMembership = {
  branchId: string;
  branchCode: string;
  branchName: string;
  branchType: BranchType;
  roleSlug: string;
  roleName: string;
  roleScope: RoleScope;
  isDefault: boolean;
};

export type AuthContext = {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    status: UserStatus;
  };
  /** Todos os vínculos ativos do usuário. */
  memberships: BranchMembership[];
  /** Filiais que o usuário pode acessar (rede → todas as ativas). */
  branchIds: string[];
  /** Verdadeiro quando o usuário tem algum papel de escopo global. */
  isNetworkScope: boolean;
  activeBranchId: string | null;
  /** Permissões concedidas por papéis de escopo global (valem em qualquer filial). */
  networkPermissions: ReadonlySet<string>;

  /**
   * Permissões que valem **naquela filial**. Sem `branchId`, responde se a
   * permissão existe em alguma filial (uso em itens que não são de filial,
   * como `notificacao:read`).
   */
  hasPermission(permission: string, branchId?: string): boolean;

  getMembership(branchId: string): BranchMembership | undefined;
};

/**
 * Monta o contexto de autorização do usuário logado.
 *
 * Lê **sempre** do banco: suspender um usuário ou remover uma permissão passa
 * a valer na requisição seguinte, sem esperar o JWT expirar.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await auth();
  const sessionUserId = session?.user?.id;

  if (!sessionUserId) return null;

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      status: true,
      active: true,
      memberships: {
        where: {
          active: true,
          branch: { active: true },
          role: { active: true },
        },
        select: {
          branchId: true,
          isDefault: true,
          branch: {
            select: { id: true, code: true, name: true, type: true },
          },
          role: {
            select: {
              slug: true,
              name: true,
              scope: true,
              rolePermissions: { select: { permissionId: true } },
            },
          },
        },
      },
    },
  });

  if (!user || !user.active || user.status !== "ACTIVE") {
    return null;
  }

  const memberships: BranchMembership[] = user.memberships.map((membership) => ({
    branchId: membership.branchId,
    branchCode: membership.branch.code,
    branchName: membership.branch.name,
    branchType: membership.branch.type,
    roleSlug: membership.role.slug,
    roleName: membership.role.name,
    roleScope: membership.role.scope,
    isDefault: membership.isDefault,
  }));

  const networkMemberships = memberships.filter(
    (membership) => membership.roleScope === "ALL_BRANCHES",
  );
  const isNetworkScope = networkMemberships.length > 0;

  const networkPermissions = new Set<string>();
  for (const membership of user.memberships) {
    if (membership.role.scope !== "ALL_BRANCHES") continue;
    for (const rp of membership.role.rolePermissions) {
      networkPermissions.add(rp.permissionId);
    }
  }

  const branchPermissions = new Map<string, Set<string>>();
  for (const membership of user.memberships) {
    if (membership.role.scope !== "OWN_BRANCHES") continue;

    const existing = branchPermissions.get(membership.branchId) ?? new Set<string>();
    for (const rp of membership.role.rolePermissions) {
      existing.add(rp.permissionId);
    }
    branchPermissions.set(membership.branchId, existing);
  }

  const ownedBranchIds = [...new Set(memberships.map((membership) => membership.branchId))];

  // Escopo de rede enxerga TODAS as unidades, inclusive as inativas: sem isso
  // não seria possível reativar uma unidade desativada. A listagem continua
  // filtrando por situação.
  const branchIds = isNetworkScope
    ? (
        await prisma.branch.findMany({
          select: { id: true },
          orderBy: { code: "asc" },
        })
      ).map((branch) => branch.id)
    : ownedBranchIds;

  const context: AuthContext = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      status: user.status,
    },
    memberships,
    branchIds,
    isNetworkScope,
    activeBranchId: null,
    networkPermissions,

    hasPermission(permission, branchId) {
      if (branchId !== undefined) {
        return (
          networkPermissions.has(permission) ||
          (branchPermissions.get(branchId)?.has(permission) ?? false)
        );
      }

      if (networkPermissions.has(permission)) return true;

      for (const permissions of branchPermissions.values()) {
        if (permissions.has(permission)) return true;
      }

      return false;
    },

    getMembership(branchId) {
      return memberships.find((membership) => membership.branchId === branchId);
    },
  };

  context.activeBranchId = await resolveActiveBranchId(context);

  return context;
});

/**
 * Filial ativa: cookie validado contra as filiais permitidas; na falta dele,
 * o vínculo padrão; por fim, a primeira filial acessível.
 */
async function resolveActiveBranchId(context: AuthContext): Promise<string | null> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(ACTIVE_BRANCH_COOKIE)?.value;

  if (fromCookie && context.branchIds.includes(fromCookie)) {
    return fromCookie;
  }

  const defaultMembership = context.memberships.find((membership) => membership.isDefault);
  if (defaultMembership && context.branchIds.includes(defaultMembership.branchId)) {
    return defaultMembership.branchId;
  }

  return context.branchIds[0] ?? null;
}
