import { ForbiddenError } from "@/lib/errors";
import type { AuthContext } from "@/server/auth/context";

/**
 * Helpers de escopo por filial.
 *
 * `AGENTS.md §3.2`: toda query de negócio é filtrada por filial. Estes
 * helpers centralizam esse filtro para não haver `findUnique` solto.
 *
 * Uso típico, dentro de um service:
 *
 *   const where = branchFilter(ctx, { branchId });
 *   await prisma.request.findMany({ where });
 */

/**
 * Filtro de filial para `where` do Prisma.
 *
 * - usuário de rede: sem filtro (vê tudo) ou filtro pela filial pedida
 * - usuário de filial: sempre restrito às suas filiais
 */
export function branchFilter(
  context: AuthContext,
  options?: { branchId?: string | null },
): { branchId?: string | { in: string[] } } {
  const requested = options?.branchId ?? null;

  if (requested) {
    if (!context.branchIds.includes(requested)) {
      throw new ForbiddenError("Você não tem acesso a esta unidade.");
    }

    return { branchId: requested };
  }

  if (context.isNetworkScope) {
    return {};
  }

  return { branchId: { in: context.branchIds } };
}

/**
 * Filtro de filial para `where` de entidades que referenciam filial por
 * coluna própria. Necessário porque cada tipo de query usa o nome da coluna.
 */
export function scopedBranchFilter(
  context: AuthContext,
  field: string,
  options?: { branchId?: string | null },
): Record<string, string | { in: string[] }> {
  const filter = branchFilter(context, options);
  const branchId = filter.branchId;

  if (branchId === undefined) return {};

  return { [field]: branchId };
}

/** Garante acesso a uma filial ou lança `ForbiddenError`. */
export function assertBranchAccess(context: AuthContext, branchId: string): void {
  if (!context.branchIds.includes(branchId)) {
    throw new ForbiddenError("Você não tem acesso a esta unidade.");
  }
}

/** Todas as filiais visíveis ao usuário. */
export function visibleBranchIds(context: AuthContext): string[] {
  return [...context.branchIds];
}

/**
 * Resolve a filial de trabalho de uma operação: a filial pedida (validada)
 * ou a filial ativa. Lança se não houver nenhuma válida.
 */
export function resolveWorkingBranch(context: AuthContext, requested?: string | null): string {
  const branchId = requested ?? context.activeBranchId;

  if (!branchId) {
    throw new ForbiddenError("Nenhuma unidade ativa. Selecione uma unidade para continuar.");
  }

  assertBranchAccess(context, branchId);

  return branchId;
}

/** Verdadeiro se o usuário atua em mais de uma filial (mostra o seletor). */
export function canSwitchBranch(context: AuthContext): boolean {
  return context.branchIds.length > 1;
}

/**
 * Lê `?filial=` de uma listagem: devolve a filial só quando ela é acessível.
 *
 * Sem filial (ou com uma inválida), o serviço decide: escopo de rede vê todas
 * as unidades, os demais ficam na filial ativa. É o que faz o link de um
 * indicador do dashboard abrir a mesma consulta que originou o número.
 */
export function readRequestedBranchId(
  context: AuthContext,
  requested: string | undefined | null,
): string | null {
  return requested && context.branchIds.includes(requested) ? requested : null;
}

/** Filiais para exibição em select, já no escopo do usuário. */
export function selectableBranches(
  context: AuthContext,
  branches: Array<{ id: string; code: string; name: string; type: string }>,
): Array<{ id: string; code: string; name: string; type: string }> {
  return branches.filter((branch) => context.branchIds.includes(branch.id));
}
