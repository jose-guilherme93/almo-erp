import { describe, expect, it } from "vitest";

import { visibleNavigation } from "@/lib/navigation";

/**
 * A navegação é a ordem em que o trabalho acontece. Estas regras são de produto:
 * Início no topo para todo mundo, Configurações no rodapé, transferência só com
 * 2+ unidades e item sem permissão invisível.
 */

const allow = () => true;

function homeHref(
  hasPermission: (permission: string) => boolean,
  isNetwork: boolean,
  activeBranchId: string | null,
) {
  const groups = visibleNavigation(hasPermission, isNetwork, 3, activeBranchId);
  return groups[0]?.items[0]?.href;
}

describe("visibleNavigation", () => {
  it("sempre abre com o grupo Início", () => {
    const groups = visibleNavigation(allow, false, 1, null);

    expect(groups[0]?.label).toBe("Início");
    expect(groups[0]?.items).toHaveLength(1);
  });

  it("manda o escopo de rede para o dashboard consolidado", () => {
    expect(homeHref(allow, true, null)).toBe("/dashboard");
  });

  it("manda o admin da unidade para o dashboard da sua filial", () => {
    const hasApprove = (permission: string) => permission === "solicitacao:approve";

    expect(homeHref(hasApprove, false, "br-1")).toBe("/dashboard/unidade/br-1");
  });

  it("cai no painel pessoal quem não tem dashboard", () => {
    // `/meu` não exige permissão: existe mesmo sem nenhuma.
    expect(homeHref(() => false, false, "br-1")).toBe("/meu");
    expect(homeHref(allow, false, null)).toBe("/meu");
  });

  it("esconde transferência numa instalação de uma unidade só", () => {
    const hasTransfer = (permission: string) => permission === "transferencia:read";

    const single = visibleNavigation(hasTransfer, false, 1);
    const multi = visibleNavigation(hasTransfer, false, 2);

    const hrefs = (groups: ReturnType<typeof visibleNavigation>) =>
      groups.flatMap((group) => group.items.map((item) => item.href));

    expect(hrefs(single)).not.toContain("/transferencias");
    expect(hrefs(multi)).toContain("/transferencias");
  });

  it("não mostra item sem permissão e não deixa grupo vazio", () => {
    const onlyCatalog = (permission: string) => permission === "item:read";
    const groups = visibleNavigation(onlyCatalog, false, 1);
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));

    expect(hrefs).toContain("/catalogo/itens");
    expect(hrefs).not.toContain("/solicitacoes/fila");
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });

  it("mantém Configurações como último grupo", () => {
    const groups = visibleNavigation(allow, true, 3, null);

    expect(groups.at(-1)?.label).toBe("Configurações");
  });
});
