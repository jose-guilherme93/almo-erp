/**
 * Testes de integração do patrimônio (FASE 23).
 *
 * Cobrem o que a fase exige: um bem por série na entrada, material sem
 * patrimônio que não gera bem, atribuição que **não** mexe no estoque, devolução,
 * baixa, transições inválidas, escopo de filial e histórico imutável.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  assignAsset,
  createAssetsFromStockLines,
  getAsset,
  listAssets,
  retireAsset,
  returnAsset,
} from "./index";
import {
  assignMaintenanceRequest,
  completeMaintenanceRequest,
  createMaintenanceRequest,
} from "@/server/services/maintenance";

const PREFIX = "TST-PAT";
const ACTOR_EMAIL = "autor.patrimonio@ator.teste.local";
const CUSTODIAN_EMAIL = "custodiante.patrimonio@ator.teste.local";
const OUTSIDER_EMAIL = "sem.vinculo.patrimonio@ator.teste.local";

let databaseAvailable = false;
let branchId = "";
let otherBranchId = "";
let unitId = "";
let categoryId = "";
let storageLocationId = "";
let roleId = "";
let actorId = "";
let custodianId = "";
let outsiderId = "";

let counter = 0;
function uniqueItemCode(): string {
  counter += 1;
  return `${PREFIX}-${Date.now().toString(36).toUpperCase()}-${counter}`;
}

/** Contexto com escopo de rede na filial do teste; as regras de filial valem. */
function context(branches: string[] = [branchId]) {
  return makeAuthContext({
    userId: actorId,
    networkPermissions: ["patrimonio:read", "patrimonio:manage"],
    networkBranchIds: branches,
    activeBranchId: branches[0] ?? null,
  });
}

/**
 * Contexto de filial (sem escopo de rede): é o que prova a barreira de escopo —
 * um usuário de rede vê tudo, e por isso não serve para o teste de vazamento.
 */
function branchContext(branches: string[]) {
  return makeAuthContext({
    userId: actorId,
    permissions: ["patrimonio:read", "patrimonio:manage"],
    memberships: branches.map((id) => ({ branchId: id })),
    activeBranchId: branches[0] ?? null,
  });
}

async function makeItem(options: { asset?: boolean } = {}) {
  return prisma.item.create({
    data: {
      code: uniqueItemCode(),
      name: "Notebook de Teste",
      categoryId,
      unitId,
      hasSerialControl: true,
      trackAsAsset: options.asset ?? true,
    },
    select: { id: true },
  });
}

async function createAssets(
  itemId: string,
  serialNumbers: string[],
  options: { quantity?: number; type?: string } = {},
) {
  return prisma.$transaction((tx) =>
    createAssetsFromStockLines(tx, {
      branchId,
      storageLocationId,
      actorId,
      type: options.type ?? "INBOUND",
      lines: [
        {
          itemId,
          quantity: new Prisma.Decimal(options.quantity ?? serialNumbers.length),
          serialNumbers,
        },
      ],
    }),
  );
}

/** Primeiro bem de um material (o teste usa apenas um bem por material). */
async function assetForItem(itemId: string) {
  return prisma.asset.findFirstOrThrow({
    where: { itemId },
    orderBy: { tag: "asc" },
    select: { id: true, tag: true },
  });
}

async function cleanup(): Promise<void> {
  // Chamados abertos pelo ator do teste (referenciam o bem e o usuário).
  const requests = await prisma.maintenanceRequest.findMany({
    where: { requesterId: actorId },
    select: { id: true },
  });
  const requestIds = requests.map((request) => request.id);
  if (requestIds.length > 0) {
    await prisma.notification.deleteMany({
      where: { entityType: "MaintenanceRequest", entityId: { in: requestIds } },
    });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: requestIds } } });
  }

  const items = await prisma.item.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length === 0) return;

  const assets = await prisma.asset.findMany({
    where: { itemId: { in: itemIds } },
    select: { id: true },
  });
  const assetIds = assets.map((asset) => asset.id);

  if (assetIds.length > 0) {
    await prisma.notification.deleteMany({ where: { entityId: { in: assetIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: assetIds } } });
    // O cascade remove os `asset_events` (permitido só por cascade, não direto).
    await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  }

  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const unit = await prisma.unit.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });
  const branches = await prisma.branch.findMany({
    where: { active: true },
    take: 2,
    select: { id: true },
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });
  const role = await prisma.role.findFirstOrThrow({
    where: { slug: "ALMOXARIFE" },
    select: { id: true },
  });

  branchId = branches[0]?.id ?? "";
  otherBranchId = branches[1]?.id ?? "";
  unitId = unit.id;
  categoryId = category.id;
  roleId = role.id;

  if (!branchId || !otherBranchId) {
    databaseAvailable = false;
    return;
  }

  const location = await prisma.storageLocation.findFirstOrThrow({
    where: { branchId },
    select: { id: true },
  });
  storageLocationId = location.id;

  const [actor, custodian, outsider] = await Promise.all([
    prisma.user.upsert({
      where: { email: ACTOR_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: ACTOR_EMAIL, name: "Autor Patrimônio", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: CUSTODIAN_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: CUSTODIAN_EMAIL, name: "Responsável Teste", status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.user.upsert({
      where: { email: OUTSIDER_EMAIL },
      update: { status: "ACTIVE" },
      create: { email: OUTSIDER_EMAIL, name: "Sem Vínculo", status: "ACTIVE" },
      select: { id: true },
    }),
  ]);

  actorId = actor.id;
  custodianId = custodian.id;
  outsiderId = outsider.id;

  // O responsável precisa de vínculo ativo na unidade do bem.
  await prisma.membership.upsert({
    where: { userId_branchId_roleId: { userId: custodianId, branchId, roleId } },
    update: { active: true },
    create: { userId: custodianId, branchId, roleId },
  });
});

beforeEach(async () => {
  if (databaseAvailable) await cleanup();
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    await prisma.membership.deleteMany({ where: { userId: custodianId } });

    for (const id of [actorId, custodianId, outsiderId]) {
      if (!id) continue;
      await prisma.auditLog.deleteMany({ where: { actorId: id } });
      await prisma.notification.deleteMany({ where: { userId: id } });
      await prisma.user.delete({ where: { id } });
    }
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("entrada gera o patrimônio", () => {
  it("cria um bem por série, no almoxarifado e sem responsável", async () => {
    const item = await makeItem();

    const created = await createAssets(item.id, ["SN-0001", "SN-0002"]);

    expect(created).toBe(2);

    const result = await listAssets(context(), { search: PREFIX });

    expect(result.total).toBe(2);
    expect(result.items.every((asset) => asset.status === "IN_STOCK")).toBe(true);
    expect(result.items.every((asset) => asset.custodian === null)).toBe(true);
    expect(result.items.every((asset) => /^PAT-\d{6}$/.test(asset.tag))).toBe(true);
  });

  it("exige uma série para cada unidade recebida", async () => {
    const item = await makeItem();

    await expect(createAssets(item.id, ["SN-0001"], { quantity: 2 })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("exige as séries na entrada de material com patrimônio", async () => {
    const item = await makeItem();

    await expect(
      prisma.$transaction((tx) =>
        createAssetsFromStockLines(tx, {
          branchId,
          storageLocationId,
          actorId,
          type: "INBOUND",
          lines: [{ itemId: item.id, quantity: new Prisma.Decimal(1), serialNumbers: [] }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("material marcado como não patrimônio não gera bem", async () => {
    const item = await makeItem({ asset: false });

    expect(await createAssets(item.id, [], { quantity: 2 })).toBe(0);

    await expect(createAssets(item.id, ["SN-0001"])).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });
});

describe.runIf(process.env["DATABASE_URL"])("posse, devolução e baixa", () => {
  async function firstAsset(itemId: string) {
    const result = await listAssets(context(), { search: PREFIX });
    const asset = result.items.find((row) => row.item.id === itemId);
    if (!asset) throw new Error("Bem não criado");
    return asset.id;
  }

  it("atribui responsável sem mexer no estoque e notifica", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-1000"]);
    const assetId = await firstAsset(item.id);

    await assignAsset(context(), { assetId, custodianUserId: custodianId });

    const asset = await getAsset(context(), assetId);

    expect(asset.status).toBe("IN_USE");
    expect(asset.custodian?.id).toBe(custodianId);
    expect(asset.events.map((event) => event.type)).toEqual(["CREATED", "ASSIGNED"]);

    // Regra 4 da fase: posse não é saída de estoque.
    const levels = await prisma.stockLevel.count({ where: { itemId: item.id } });
    expect(levels).toBe(0);

    const notification = await prisma.notification.findFirst({
      where: { userId: custodianId, type: "ASSET_ASSIGNED" },
      select: { id: true },
    });
    expect(notification).not.toBeNull();
  });

  it("recusa responsável sem vínculo na unidade", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-2000"]);
    const assetId = await firstAsset(item.id);

    await expect(
      assignAsset(context(), { assetId, custodianUserId: outsiderId }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("devolve ao almoxarifado", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-3000"]);
    const assetId = await firstAsset(item.id);

    await assignAsset(context(), { assetId, custodianUserId: custodianId });
    await returnAsset(context(), { assetId });

    const asset = await getAsset(context(), assetId);

    expect(asset.status).toBe("IN_STOCK");
    expect(asset.custodian).toBeNull();
    expect(asset.events.map((event) => event.type)).toEqual(["CREATED", "ASSIGNED", "RETURNED"]);
  });

  it("baixa exige motivo e é terminal", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-4000"]);
    const assetId = await firstAsset(item.id);

    await expect(retireAsset(context(), { assetId, reason: "curto" })).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });

    await retireAsset(context(), { assetId, reason: "Equipamento sem conserto." });

    const asset = await getAsset(context(), assetId);
    expect(asset.status).toBe("RETIRED");

    await expect(
      assignAsset(context(), { assetId, custodianUserId: custodianId }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("escopo e histórico", () => {
  it("não enxerga bem de filial fora do escopo", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-5000"]);
    const assetId = (await listAssets(context(), { search: PREFIX })).items[0]?.id ?? "";

    const otherContext = branchContext([otherBranchId]);

    expect((await listAssets(otherContext, { search: PREFIX })).total).toBe(0);
    await expect(getAsset(otherContext, assetId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("o histórico não pode ser alterado nem apagado direto", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-6000"]);

    const event = await prisma.assetEvent.findFirstOrThrow({
      where: { asset: { itemId: item.id } },
      select: { id: true },
    });

    await expect(
      prisma.assetEvent.update({ where: { id: event.id }, data: { notes: "adulterado" } }),
    ).rejects.toThrow();

    await expect(prisma.assetEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it("apagar o bem remove o histórico junto (cascade)", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-7000"]);
    const asset = await prisma.asset.findFirstOrThrow({
      where: { itemId: item.id },
      select: { id: true },
    });

    await prisma.asset.delete({ where: { id: asset.id } });

    expect(await prisma.assetEvent.count({ where: { assetId: asset.id } })).toBe(0);
  });
});

describe.runIf(process.env["DATABASE_URL"])("chamado vinculado ao bem", () => {
  it("abrir o chamado põe o bem em manutenção e concluir devolve ao estado anterior", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-8000"]);
    const asset = await assetForItem(item.id);

    // O bem estava em posse de alguém: a manutenção deve devolvê-lo a IN_USE.
    await assignAsset(context(), { assetId: asset.id, custodianUserId: custodianId });

    const request = await createMaintenanceRequest(context(), {
      branchId,
      category: "IT",
      title: "Notebook não liga",
      description: "O notebook da recepção não liga desde ontem.",
      location: "Recepção",
      assetTag: asset.tag,
    });

    const inMaintenance = await getAsset(context(), asset.id);
    expect(inMaintenance.status).toBe("IN_MAINTENANCE");
    expect(inMaintenance.events.map((event) => event.type)).toContain("MAINTENANCE_STARTED");

    await assignMaintenanceRequest(context(), {
      requestId: request.id,
      assignedToId: custodianId,
    });
    await completeMaintenanceRequest(context(), {
      requestId: request.id,
      resolution: "Trocada a fonte de alimentação.",
    });

    const back = await getAsset(context(), asset.id);
    expect(back.status).toBe("IN_USE");
    expect(back.custodian?.id).toBe(custodianId);
    expect(back.events.map((event) => event.type)).toContain("MAINTENANCE_DONE");
  });

  it("aceita a etiqueta na forma legível e ignora texto que não é bem", async () => {
    const item = await makeItem();
    await createAssets(item.id, ["SN-8100"]);
    const asset = await assetForItem(item.id);

    // Forma legível: `PAT 000 123`.
    const linked = await createMaintenanceRequest(context(), {
      branchId,
      category: "IT",
      title: "Monitor sem imagem",
      description: "O monitor não liga de jeito nenhum.",
      location: "Sala 2",
      assetTag: `PAT ${asset.tag.slice(4, 7)} ${asset.tag.slice(7)}`,
    });

    expect((await getAsset(context(), asset.id)).status).toBe("IN_MAINTENANCE");

    await assignMaintenanceRequest(context(), {
      requestId: linked.id,
      assignedToId: custodianId,
    });
    await completeMaintenanceRequest(context(), {
      requestId: linked.id,
      resolution: "Cabo HDMI trocado.",
    });

    // Texto que não corresponde a bem nenhum continua só como anotação.
    const unlinked = await createMaintenanceRequest(context(), {
      branchId,
      category: "IT",
      title: "Projetor com defeito",
      description: "O projetor da sala de reunião pisca.",
      location: "Sala de reunião",
      assetTag: "sem-etiqueta-9999",
    });

    const row = await prisma.maintenanceRequest.findUniqueOrThrow({
      where: { id: unlinked.id },
      select: { assetId: true },
    });
    expect(row.assetId).toBeNull();
  });
});
