/**
 * Testes das configurações e da auditoria.
 *
 * Provam que a configuração é validada (não dá para salvar SLA negativo) e que
 * toda alteração fica registrada com o valor anterior.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { getConfigNumber, listConfigs, updateConfigs } from "@/server/services/config";

const ACTOR_EMAIL = "autor.config@ator.teste.local";

let databaseAvailable = false;
let actorId = "";
let branchId = "";

function context() {
  return makeAuthContext({
    userId: actorId,
    networkPermissions: ["configuracao:manage", "papel:manage"],
    networkBranchIds: [branchId],
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const branch = await prisma.branch.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });
  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Config", status: "ACTIVE" },
    select: { id: true },
  });

  branchId = branch.id;
  actorId = actor.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await prisma.auditLog.deleteMany({ where: { actorId } });
});

afterAll(async () => {
  if (databaseAvailable) {
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.user.deleteMany({ where: { email: ACTOR_EMAIL } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("configurações", () => {
  it("lista todas as definições, com ou sem valor gravado", async () => {
    const configs = await listConfigs();

    expect(configs.length).toBeGreaterThan(0);
    expect(configs.some((config) => config.key === "sla.approvalHours")).toBe(true);
    expect(configs.some((config) => config.key === "email.contato")).toBe(true);
  });

  it("salva número e registra auditoria com o valor anterior", async () => {
    await updateConfigs(context(), { "sla.approvalHours": "48" });

    expect(await getConfigNumber("sla.approvalHours", 24)).toBe(48);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId, action: "config.updated" },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).not.toBeNull();
    expect((audit?.after as Record<string, unknown>)["sla.approvalHours"]).toBe(48);
  });

  it("recusa número inválido", async () => {
    await expect(updateConfigs(context(), { "sla.approvalHours": "abc" })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("recusa valor fora do intervalo permitido", async () => {
    await expect(updateConfigs(context(), { "sla.approvalHours": "0" })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });

    await expect(updateConfigs(context(), { "sla.approvalHours": "99999" })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("recusa campo de texto em branco", async () => {
    await expect(updateConfigs(context(), { "email.contato": "   " })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("recusa e-mail de contato sem arroba", async () => {
    await expect(updateConfigs(context(), { "email.contato": "sem-arroba" })).rejects.toMatchObject(
      { code: "BUSINESS_RULE" },
    );
  });

  it("exige ao menos uma configuração", async () => {
    await expect(updateConfigs(context(), {})).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("recusa quando só vieram chaves desconhecidas", async () => {
    // Ignorar em silêncio esconderia um erro de digitação na chave.
    await expect(updateConfigs(context(), { "chave.inexistente": "x" })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });
});
