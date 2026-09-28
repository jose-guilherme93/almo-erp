import { redirect } from "next/navigation";

import { ForbiddenError } from "@/lib/errors";
import { getAuthContext, type AuthContext } from "@/server/auth/context";

/**
 * Guards de autorização.
 *
 * Regra do projeto (AGENTS.md §3.1): **toda** Server Action e todo Route
 * Handler chama um guard antes de qualquer query. O middleware não conta.
 *
 * Há duas famílias:
 *   - `require*` → lança `ForbiddenError` (uso em actions e services)
 *   - `requirePage*` → redireciona para `/forbidden` (uso em páginas)
 */

/* -------------------------------------------------------------------------- */
/* Uso em Server Actions e services                                            */
/* -------------------------------------------------------------------------- */

/** Exige sessão válida com usuário ACTIVE. */
export async function requireSession(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    redirect("/login");
  }

  return context;
}

/**
 * Exige uma permissão.
 *
 * Com `branchId`, a permissão é avaliada **naquela filial** — isso impede que
 * um papel de uma filial valha em outra (ex.: ADMIN_FILIAL em SP não aprova
 * em RJ).
 */
export async function requirePermission(
  permission: string,
  branchId?: string,
): Promise<AuthContext> {
  const context = await requireSession();

  if (!context.hasPermission(permission, branchId)) {
    throw new ForbiddenError();
  }

  return context;
}

/** Exige ao menos uma das permissões, na filial informada quando houver. */
export async function requireAnyPermission(
  permissions: readonly string[],
  branchId?: string,
): Promise<AuthContext> {
  const context = await requireSession();

  const allowed = permissions.some((permission) => context.hasPermission(permission, branchId));

  if (!allowed) {
    throw new ForbiddenError();
  }

  return context;
}

/** Exige um papel específico (uso pontual, quando a permissão não basta). */
export async function requireRole(slugs: readonly string[]): Promise<AuthContext> {
  const context = await requireSession();

  const hasRole = context.memberships.some((membership) => slugs.includes(membership.roleSlug));

  if (!hasRole) {
    throw new ForbiddenError();
  }

  return context;
}

/** Exige escopo de rede (matriz / super admin). */
export async function requireNetworkScope(): Promise<AuthContext> {
  const context = await requireSession();

  if (!context.isNetworkScope) {
    throw new ForbiddenError("Esta área é restrita à administração da matriz.");
  }

  return context;
}

/**
 * Exige que a filial informada esteja no escopo do usuário.
 *
 * Deve ser chamado em **toda** action que receba `branchId` de fora, mesmo
 * depois de `requirePermission` sem filial.
 */
export async function requireBranch(branchId: string): Promise<AuthContext> {
  const context = await requireSession();

  if (!context.branchIds.includes(branchId)) {
    throw new ForbiddenError("Você não tem acesso a esta unidade.");
  }

  return context;
}

/* -------------------------------------------------------------------------- */
/* Uso em páginas (Server Components)                                          */
/* -------------------------------------------------------------------------- */

/** Exige sessão; sem ela, vai para a tela de acesso negado. */
export async function requirePageSession(): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    redirect("/acesso-negado?motivo=access-denied");
  }

  return context;
}

export async function requirePagePermission(
  permission: string,
  branchId?: string,
): Promise<AuthContext> {
  const context = await requirePageSession();

  if (!context.hasPermission(permission, branchId)) {
    redirect("/forbidden");
  }

  return context;
}

export async function requirePageAnyPermission(
  permissions: readonly string[],
  branchId?: string,
): Promise<AuthContext> {
  const context = await requirePageSession();

  const allowed = permissions.some((entry) => context.hasPermission(entry, branchId));

  if (!allowed) {
    redirect("/forbidden");
  }

  return context;
}

export async function requirePageNetworkScope(): Promise<AuthContext> {
  const context = await requirePageSession();

  if (!context.isNetworkScope) {
    redirect("/forbidden");
  }

  return context;
}

/** Exige acesso à filial; caso contrário, 403 amigável (nunca redirect silencioso). */
export async function requirePageBranch(branchId: string): Promise<AuthContext> {
  const context = await requirePageSession();

  if (!context.branchIds.includes(branchId)) {
    redirect("/forbidden");
  }

  return context;
}

/** Filial ativa + contexto, para telas que sempre operam sobre uma unidade. */
export async function requirePageActiveBranch(): Promise<{
  context: AuthContext;
  branchId: string;
}> {
  const context = await requirePageSession();

  if (!context.activeBranchId) {
    redirect("/acesso-negado?motivo=access-denied");
  }

  return { context, branchId: context.activeBranchId };
}
