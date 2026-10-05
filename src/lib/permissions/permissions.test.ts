import { describe, expect, it } from "vitest";

import {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSIONS,
  isPermissionKey,
  permissionsByGroup,
} from "@/lib/permissions/catalog";
import { ROLES, ROLE_SLUGS, isRoleSlug, permissionsForRole } from "@/lib/permissions/matrix";

describe("catálogo de permissões", () => {
  it("não tem chaves duplicadas", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("usa o formato recurso:acao em todas as chaves", () => {
    for (const permission of PERMISSIONS) {
      expect(permission.key).toBe(`${permission.resource}:${permission.action}`);
      expect(permission.key).toMatch(/^[a-z-]+:[a-z]+$/);
    }
  });

  it("classifica todas as permissões em um grupo conhecido", () => {
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_GROUPS).toContain(permission.group);
    }
  });

  it("todo grupo declarado tem ao menos uma permissão", () => {
    const grouped = permissionsByGroup();

    expect(grouped).toHaveLength(PERMISSION_GROUPS.length);
    for (const entry of grouped) {
      expect(entry.permissions.length).toBeGreaterThan(0);
    }
  });

  it("preserva a ordem dos grupos e a ordem interna de cada grupo", () => {
    const grouped = permissionsByGroup();

    expect(grouped.map((entry) => entry.group)).toEqual([...PERMISSION_GROUPS]);
  });

  it("isPermissionKey reconhece chaves válidas e rejeita o resto", () => {
    expect(isPermissionKey("solicitacao:approve")).toBe(true);
    expect(isPermissionKey("solicitacao:aprovar")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
    expect(isPermissionKey("__proto__")).toBe(false);
  });
});

describe("matriz papel × permissão", () => {
  it("define exatamente os papéis de sistema, na ordem de ROLE_SLUGS", () => {
    expect(ROLES.map((role) => role.slug)).toEqual([...ROLE_SLUGS]);
  });

  it("TI atende chamados sem visão geral do almoxarifado", () => {
    const permissions = permissionsForRole("TI");

    expect(permissions).toContain("manutencao:atender");
    expect(permissions).toContain("manutencao:delegar");
    expect(permissions).not.toContain("manutencao:overview");
    expect(permissions).not.toContain("solicitacao:overview");
    expect(permissions).not.toContain("estoque:entrada");
  });

  it("SOLICITANTE não enxerga estoque, transferências nem catálogo de gestão", () => {
    const permissions = permissionsForRole("SOLICITANTE");

    expect(permissions).toContain("solicitacao:create");
    expect(permissions).toContain("manutencao:create");
    expect(permissions).not.toContain("solicitacao:overview");
    expect(permissions).not.toContain("estoque:read");
    expect(permissions).not.toContain("transferencia:read");
    expect(permissions).not.toContain("item:read");
    expect(permissions).not.toContain("categoria:read");
  });

  it("só usa permissões existentes no catálogo", () => {
    for (const role of ROLES) {
      if (role.permissions === "*") continue;

      for (const permission of role.permissions) {
        expect(PERMISSION_KEYS).toContain(permission);
      }
    }
  });

  it("SUPER_ADMIN tem todas as permissões e escopo global", () => {
    expect(permissionsForRole("SUPER_ADMIN")).toHaveLength(PERMISSION_KEYS.length);

    const role = ROLES.find((entry) => entry.slug === "SUPER_ADMIN");
    expect(role?.scope).toBe("ALL_BRANCHES");
  });

  it("ADMIN_MATRIZ tem escopo global mas não administra papéis, e-mail nem configurações", () => {
    const permissions = permissionsForRole("ADMIN_MATRIZ");

    expect(ROLES.find((r) => r.slug === "ADMIN_MATRIZ")?.scope).toBe("ALL_BRANCHES");
    expect(permissions).not.toContain("papel:manage");
    expect(permissions).not.toContain("politica-email:manage");
    expect(permissions).not.toContain("configuracao:manage");
    expect(permissions).toContain("filial:manage");
    expect(permissions).toContain("usuario:manage");
  });

  it("todos os papéis exceto SUPER_ADMIN e ADMIN_MATRIZ têm escopo por filial", () => {
    const networkRoles = ["SUPER_ADMIN", "ADMIN_MATRIZ"];

    for (const role of ROLES) {
      if (networkRoles.includes(role.slug)) continue;
      expect(role.scope).toBe("OWN_BRANCHES");
    }
  });

  it("SOLICITANTE cria solicitação mas não aprova nem entrega", () => {
    const permissions = permissionsForRole("SOLICITANTE");

    expect(permissions).toContain("solicitacao:create");
    expect(permissions).toContain("solicitacao:read");
    expect(permissions).not.toContain("solicitacao:approve");
    expect(permissions).not.toContain("solicitacao:entregar");
    expect(permissions).not.toContain("estoque:entrada");
    expect(permissions).not.toContain("estoque:ajuste");
  });

  it("GESTOR aprova solicitações mas não lança estoque", () => {
    const permissions = permissionsForRole("GESTOR");

    expect(permissions).toContain("solicitacao:approve");
    expect(permissions).not.toContain("estoque:entrada");
    expect(permissions).not.toContain("estoque:ajuste");
    expect(permissions).not.toContain("estoque:saida");
  });

  it("ALMOXARIFE lança estoque e entrega, mas não aprova solicitação", () => {
    const permissions = permissionsForRole("ALMOXARIFE");

    expect(permissions).toContain("estoque:entrada");
    expect(permissions).toContain("estoque:ajuste");
    expect(permissions).toContain("estoque:saida");
    expect(permissions).toContain("solicitacao:entregar");
    expect(permissions).toContain("transferencia:enviar");
    expect(permissions).toContain("transferencia:receber");
    expect(permissions).not.toContain("solicitacao:approve");
    expect(permissions).not.toContain("usuario:manage");
  });

  // Quem recebe a mercadoria registra o material que chega: sem `item:create` o
  // caminho da doca morre para o próprio almoxarife.
  it("ALMOXARIFE cadastra material, mas não edita nem desativa", () => {
    const permissions = permissionsForRole("ALMOXARIFE");

    expect(permissions).toContain("item:create");
    expect(permissions).not.toContain("item:update");
    expect(permissions).not.toContain("item:manage");
  });

  it("CONSULTA é somente leitura: nenhuma permissão de escrita", () => {
    const permissions = permissionsForRole("CONSULTA");
    const writeActions = [
      "create",
      "update",
      "manage",
      "entrada",
      "saida",
      "ajuste",
      "approve",
      "entregar",
      "enviar",
      "receber",
    ];

    for (const permission of permissions) {
      const action = permission.split(":")[1] ?? "";
      expect(writeActions).not.toContain(action);
    }
  });

  it("CONSULTA não enxerga administração de usuários", () => {
    expect(permissionsForRole("CONSULTA")).not.toContain("usuario:read");
  });

  it("todo papel pode ler notificações (a caixa é de cada um)", () => {
    for (const role of ROLES) {
      expect(permissionsForRole(role.slug)).toContain("notificacao:read");
    }
  });

  it("permissionsForRole devolve lista vazia para slug inexistente", () => {
    // @ts-expect-error — testando entrada inválida em runtime.
    expect(permissionsForRole("NAO_EXISTE")).toEqual([]);
  });

  it("isRoleSlug valida corretamente", () => {
    expect(isRoleSlug("GESTOR")).toBe(true);
    expect(isRoleSlug("gestor")).toBe(false);
    expect(isRoleSlug("ADMIN")).toBe(false);
  });
});
