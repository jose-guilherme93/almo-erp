import type { BranchType, RoleScope, UserStatus } from "@/generated/prisma/enums";
import type { AuthContext, BranchMembership } from "@/server/auth/context";

/**
 * Construtor de `AuthContext` para testes.
 *
 * Permite exercitar as regras de escopo e permissão sem passar pelo login.
 * O objeto montado tem a mesma forma do real, então um teste que passa aqui
 * passa com o contexto de produção.
 */

export type MembershipSpec = {
  branchId: string;
  branchCode?: string;
  branchName?: string;
  branchType?: BranchType;
  roleSlug?: string;
  roleName?: string;
  roleScope?: RoleScope;
  isDefault?: boolean;
};

export type AuthContextSpec = {
  userId?: string;
  email?: string;
  name?: string;
  memberships?: MembershipSpec[];
  /** Permissões concedidas em cada filial. */
  permissions?: string[];
  /** Permissões que valem em qualquer filial (papéis de rede). */
  networkPermissions?: string[];
  /** Todas as filiais visíveis quando há papel de rede. */
  networkBranchIds?: string[];
  activeBranchId?: string | null;
};

export function makeAuthContext(spec: AuthContextSpec = {}): AuthContext {
  const specs: MembershipSpec[] = spec.memberships ?? [{ branchId: "branch-a" }];

  const memberships: BranchMembership[] = specs.map((entry) => ({
    branchId: entry.branchId,
    branchCode: entry.branchCode ?? entry.branchId.toUpperCase(),
    branchName: entry.branchName ?? `Unidade ${entry.branchId}`,
    branchType: entry.branchType ?? ("BRANCH" as BranchType),
    roleSlug: entry.roleSlug ?? "GESTOR",
    roleName: entry.roleName ?? "Gestor",
    roleScope: entry.roleScope ?? ("OWN_BRANCHES" as RoleScope),
    isDefault: entry.isDefault ?? false,
  }));

  const isNetworkScope = spec.networkPermissions !== undefined;

  const branchIds = isNetworkScope
    ? (spec.networkBranchIds ?? [...new Set(memberships.map((entry) => entry.branchId))])
    : [...new Set(memberships.map((entry) => entry.branchId))];

  const networkPermissions = new Set(spec.networkPermissions ?? []);
  const branchPermissions = new Set(spec.permissions ?? []);

  const context: AuthContext = {
    user: {
      id: spec.userId ?? "user-1",
      email: spec.email ?? "teste@exemplo.com.br",
      name: spec.name ?? "Usuário de Teste",
      avatarUrl: null,
      status: "ACTIVE" as UserStatus,
    },
    memberships,
    branchIds,
    isNetworkScope,
    activeBranchId: spec.activeBranchId ?? branchIds[0] ?? null,
    networkPermissions,

    hasPermission(permission, branchId) {
      if (branchId !== undefined) {
        const canUseBranch = branchIds.includes(branchId);
        if (!canUseBranch) return false;

        return networkPermissions.has(permission) || branchPermissions.has(permission);
      }

      return networkPermissions.has(permission) || branchPermissions.has(permission);
    },

    getMembership(branchId) {
      return memberships.find((entry) => entry.branchId === branchId);
    },
  };

  return context;
}
