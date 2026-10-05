/**
 * Testes de integração do serviço de filiais.
 *
 * Cobrem os bloqueios que evitam estrago operacional: ciclo de hierarquia,
 * desativar unidade com material em trânsito, com saldo ou sendo a matriz.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import type { CreateBranchInput, UpdateBranchInput } from "@/lib/validation/branch";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  DEFAULT_LOCATION_CODE,
  DEFAULT_LOCATION_NAME,
  createBranch,
  deactivateBranch,
  listBranches,
  updateBranch,
} from "@/server/services/branch";

const TEST_PREFIX = "TST-";
const ACTOR_EMAIL = "autor.filial@ator.teste.local";

let databaseAvailable = false;
let actorId = "";
let matrixId = "";
let realBranchId = "";

/**
 * Contexto de quem pode tudo em filiais (matriz da rede).
 *
 * As filiais visíveis são lidas do banco a cada chamada: unidades criadas
 * dentro do teste precisam entrar no escopo, como aconteceria na aplicação
 * (o contexto é remontado a cada requisição).
 */
async function networkContext(withPermission = true) {
  // Inclui inativas: é assim que a aplicação permite reativar uma unidade.
  const branches = await prisma.branch.findMany({ select: { id: true } });

  return makeAuthContext({
    userId: actorId,
    networkPermissions: withPermission ? ["filial:read", "filial:manage", "filial:create"] : [],
    networkBranchIds: branches.map((branch) => branch.id),
  });
}

async function cleanup(): Promise<void> {
  const branches = await prisma.branch.findMany({
    where: { code: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });

  const ids = branches.map((branch) => branch.id);

  if (ids.length > 0) {
    // Ordem importa: saldo referencia o local, que referencia a unidade.
    await prisma.branch.updateMany({ where: { id: { in: ids } }, data: { parentId: null } });
    await prisma.stockLevel.deleteMany({ where: { branchId: { in: ids } } });
    await prisma.storageLocation.deleteMany({ where: { branchId: { in: ids } } });
    await prisma.itemStockPolicy.deleteMany({ where: { branchId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { branchId: { in: ids } } });
    await prisma.branch.deleteMany({ where: { id: { in: ids } } });
  }
}

/**
 * Entrada completa de unidade.
 *
 * O tipo do serviço vem do schema Zod, onde os campos opcionais são
 * `T | undefined` (chave obrigatória, valor possivelmente ausente) — por isso
 * o helper declara todos explicitamente.
 */
function baseInput(
  code: string,
  cnpj: string,
  extra: Partial<CreateBranchInput> = {},
): CreateBranchInput {
  return {
    code,
    name: `Unidade ${code}`,
    type: "BRANCH",
    cnpj,
    legalName: undefined,
    tradeName: undefined,
    stateRegistration: undefined,
    cnae: undefined,
    zipCode: undefined,
    street: undefined,
    number: undefined,
    complement: undefined,
    district: undefined,
    city: undefined,
    state: undefined,
    country: "Brasil",
    latitude: undefined,
    longitude: undefined,
    email: undefined,
    phone: undefined,
    whatsapp: undefined,
    legalResponsibleId: undefined,
    legalResponsibleName: undefined,
    legalResponsibleDocument: undefined,
    warehouseResponsibleId: undefined,
    notificationResponsibleId: undefined,
    defaultApproverId: undefined,
    businessHours: undefined,
    notes: undefined,
    parentId: undefined,
    active: true,
    ...extra,
  };
}

/** Mesma entrada, com o `branchId` exigido pela edição. */
function editInput(
  branchId: string,
  code: string,
  cnpj: string,
  extra: Partial<UpdateBranchInput> = {},
): UpdateBranchInput {
  return { ...baseInput(code, cnpj), branchId, ...extra };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const matrix = await prisma.branch.findFirst({
    where: { type: "MATRIX" },
    select: { id: true },
  });
  const branch = await prisma.branch.findFirst({
    where: { type: "BRANCH" },
    select: { id: true },
  });

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Filial", status: "ACTIVE" },
    select: { id: true },
  });

  actorId = actor.id;
  matrixId = matrix?.id ?? "";
  realBranchId = branch?.id ?? "";

  if (!matrixId || !realBranchId) databaseAvailable = false;
});

beforeEach(async () => {
  if (!databaseAvailable) return;
  await cleanup();
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();
    const actor = await prisma.user.findUnique({
      where: { email: ACTOR_EMAIL },
      select: { id: true },
    });

    if (actor) {
      await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("cadastro de unidade", () => {
  it("cria unidade com CNPJ válido e registra auditoria", async () => {
    const branch = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}001`, "99999999000191"),
    );

    const saved = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });

    expect(saved.code).toBe(`${TEST_PREFIX}001`);
    expect(saved.cnpj).toBe("99999999000191");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Branch", entityId: branch.id },
    });

    expect(audit?.action).toBe("branch.created");
  });

  it("recusa código repetido", async () => {
    await createBranch(await networkContext(), baseInput(`${TEST_PREFIX}002`, "99999999000191"));

    await expect(
      createBranch(await networkContext(), baseInput(`${TEST_PREFIX}002`, "99999999000353")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("recusa CNPJ já usado por outra unidade", async () => {
    await createBranch(await networkContext(), baseInput(`${TEST_PREFIX}003`, "99999999000191"));

    await expect(
      createBranch(await networkContext(), baseInput(`${TEST_PREFIX}004`, "99999999000191")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("ADMIN_FILIAL de uma unidade não enxerga outra unidade", async () => {
    await createBranch(await networkContext(), baseInput(`${TEST_PREFIX}005`, "99999999000191"));

    const restricted = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId: realBranchId, roleSlug: "ADMIN_FILIAL" }],
      permissions: ["filial:read"],
    });

    const result = await listBranches(restricted, { pageSize: 200 });

    expect(result.items.map((item) => item.id)).toEqual([realBranchId]);
  });

  // Sem isto, a primeira entrada de estoque morre em "nenhum local cadastrado".
  it("cria a unidade já com o almoxarifado", async () => {
    const branch = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}006`, "99999999000191"),
    );

    const locations = await prisma.storageLocation.findMany({
      where: { branchId: branch.id },
      select: { code: true, name: true, type: true },
    });

    expect(locations).toEqual([
      { code: DEFAULT_LOCATION_CODE, name: DEFAULT_LOCATION_NAME, type: "MAIN_WAREHOUSE" },
    ]);
  });
});

describe.runIf(process.env["DATABASE_URL"])("hierarquia", () => {
  it("recusa hierarquia cíclica", async () => {
    const parent = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}P`, "99999999000191"),
    );

    const child = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}C`, "99999999000272", { parentId: parent.id }),
    );

    // Tornar o pai subordinado ao filho fecharia o ciclo.
    await expect(
      updateBranch(
        await networkContext(),
        editInput(parent.id, `${TEST_PREFIX}P`, "99999999000191", { parentId: child.id }),
      ),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("recusa unidade como superior dela mesma", async () => {
    const branch = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}S`, "99999999000191"),
    );

    await expect(
      updateBranch(
        await networkContext(),
        editInput(branch.id, `${TEST_PREFIX}S`, "99999999000191", { parentId: branch.id }),
      ),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("desativação", () => {
  it("não permite desativar a matriz", async () => {
    await expect(
      deactivateBranch(await networkContext(), { branchId: matrixId }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("não permite desativar unidade com saldo em estoque", async () => {
    const branch = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}D`, "99999999000191"),
    );

    // A unidade nasce com o almoxarifado: usa o local que `createBranch` criou.
    const location = await prisma.storageLocation.findFirstOrThrow({
      where: { branchId: branch.id },
      select: { id: true },
    });

    const item = await prisma.item.findFirstOrThrow({ select: { id: true } });

    await prisma.stockLevel.create({
      data: {
        itemId: item.id,
        storageLocationId: location.id,
        branchId: branch.id,
        quantity: "10.0000",
      },
    });

    await expect(
      deactivateBranch(await networkContext(), { branchId: branch.id }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const stillActive = await prisma.branch.findUniqueOrThrow({
      where: { id: branch.id },
      select: { active: true },
    });

    expect(stillActive.active).toBe(true);
  });

  it("desativa unidade sem pendências", async () => {
    const branch = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}L`, "99999999000191"),
    );

    await deactivateBranch(await networkContext(), {
      branchId: branch.id,
      reason: "teste automatizado",
    });

    const saved = await prisma.branch.findUniqueOrThrow({
      where: { id: branch.id },
      select: { active: true },
    });

    expect(saved.active).toBe(false);
  });

  it("não desativa unidade já inativa", async () => {
    const branch = await createBranch(
      await networkContext(),
      baseInput(`${TEST_PREFIX}I`, "99999999000191"),
    );

    await deactivateBranch(await networkContext(), { branchId: branch.id });

    await expect(
      deactivateBranch(await networkContext(), { branchId: branch.id }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});
