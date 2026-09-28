import { REQUEST_STATUS_LABELS } from "@/server/services/request/transitions";
import type { AuthContext } from "@/server/auth/context";
import { visibleBranchIds } from "@/server/auth/scope";

/**
 * Home correta por perfil (FASE 10).
 *
 * A regra é explícita para o usuário nunca cair numa tela vazia:
 *   - escopo de rede  → dashboard da matriz
 *   - quem aprova     → dashboard da sua unidade
 *   - demais          → minhas solicitações
 */
export function resolveHomeRoute(context: AuthContext): string {
  if (context.isNetworkScope) {
    return "/dashboard";
  }

  const activeBranchId = context.activeBranchId;

  if (activeBranchId && context.hasPermission("solicitacao:approve", activeBranchId)) {
    return `/dashboard/unidade/${activeBranchId}`;
  }

  // Procura qualquer unidade onde o usuário possa aprovar.
  const approverBranch = context.branchIds.find((branchId) =>
    context.hasPermission("solicitacao:approve", branchId),
  );

  if (approverBranch) {
    return `/dashboard/unidade/${approverBranch}`;
  }

  return "/meu";
}

/** Descrição curta do perfil do usuário, para o cabeçalho da home. */
export function describeProfile(context: AuthContext): string {
  if (context.isNetworkScope) {
    return "Você acompanha a rede inteira.";
  }

  const activeBranchId = context.activeBranchId;

  if (activeBranchId && context.hasPermission("solicitacao:approve", activeBranchId)) {
    return "Você responde pelos chamados da sua unidade.";
  }

  if (activeBranchId && context.hasPermission("solicitacao:entregar", activeBranchId)) {
    return "Você opera o almoxarifado da sua unidade.";
  }

  return "Aqui você pede material e acompanha seus pedidos.";
}

/** Itens de menu do dashboard que o perfil pode ver. */
export function dashboardRoutes(context: AuthContext): Array<{
  label: string;
  href: string;
  description: string;
}> {
  const routes: Array<{ label: string; href: string; description: string }> = [];

  if (context.isNetworkScope) {
    routes.push(
      {
        label: "Dashboard da matriz",
        href: "/dashboard",
        description: "Consolidado de toda a rede.",
      },
      {
        label: "Visão por unidade",
        href: "/dashboard/unidades",
        description: "Comparativo entre as unidades.",
      },
    );
  }

  for (const branchId of visibleBranchIds(context)) {
    if (!context.hasPermission("solicitacao:approve", branchId)) continue;

    const membership = context.getMembership(branchId);

    routes.push({
      label: membership ? `Unidade ${membership.branchCode}` : "Minha unidade",
      href: `/dashboard/unidade/${branchId}`,
      description: "Chamados, entregas e indicadores da unidade.",
    });
  }

  return routes;
}

/** Rótulo do status, para onde o dicionário de badges não é usado. */
export function requestStatusLabel(status: string): string {
  return REQUEST_STATUS_LABELS[status as keyof typeof REQUEST_STATUS_LABELS] ?? status;
}
