/**
 * Seed de demonstração — dados operacionais para explorar o sistema.
 *
 * Diferente do `seed.ts` (que cria a estrutura: filiais, catálogo, papéis), este
 * script cria **movimento**: estoque, solicitações em cada estágio, uma
 * transferência em trânsito e histórico de consumo para os gráficos.
 *
 * Roda apenas fora de produção. É idempotente na prática: começa limpando os
 * dados operacionais que ele mesmo cria (identificados pelo prefixo `DEMO`).
 *
 * Uso: pnpm db:seed:demo
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { AuthContext } from "../src/server/auth/context";
import { createAndPostStockDocument } from "../src/server/services/stock/post-document";
import { approveRequest, createRequest, deliverRequest } from "../src/server/services/request";
import { createTransfer, sendTransfer } from "../src/server/services/transfer";
import {
  assignMaintenanceRequest,
  completeMaintenanceRequest,
  createMaintenanceRequest,
  setMaintenancePriority,
} from "../src/server/services/maintenance";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL não definida. Copie .env.example para .env.");
}

if (process.env["NODE_ENV"] === "production") {
  throw new Error("O seed de demonstração não roda em produção.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const d = (value: string | number) => new Prisma.Decimal(value);

/** Contexto mínimo de autorização, equivalente ao montado em runtime. */
function makeContext(input: {
  userId: string;
  email: string;
  name: string;
  branchId: string;
  permissions: string[];
  isNetworkScope?: boolean;
  allBranchIds?: string[];
}): AuthContext {
  const memberships = [
    {
      branchId: input.branchId,
      branchCode: input.branchId.slice(0, 6),
      branchName: "",
      branchType: "BRANCH" as const,
      roleSlug: "DEMO",
      roleName: "Demonstração",
      roleScope: input.isNetworkScope ? ("ALL_BRANCHES" as const) : ("OWN_BRANCHES" as const),
      isDefault: true,
      sectorId: null,
      sectorName: null,
    },
  ];

  const branchIds = input.isNetworkScope
    ? (input.allBranchIds ?? [input.branchId])
    : [input.branchId];
  const permissions = new Set(input.permissions);

  return {
    user: {
      id: input.userId,
      email: input.email,
      name: input.name,
      avatarUrl: null,
      status: "ACTIVE",
    },
    memberships,
    sectorIds: [],
    branchIds,
    isNetworkScope: input.isNetworkScope ?? false,
    activeBranchId: input.branchId,
    activeSectorId: null,
    networkPermissions: input.isNetworkScope ? permissions : new Set<string>(),
    hasPermission(permission, branchId) {
      if (branchId !== undefined && !branchIds.includes(branchId)) return false;
      return permissions.has(permission);
    },
    getMembership(branchId) {
      return memberships.find((membership) => membership.branchId === branchId);
    },
  };
}

async function resetDemoData(): Promise<void> {
  // Remove o que este seed cria: pedidos, transferências e documentos dos
  // usuários de demonstração. Os dados de estrutura permanecem.
  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@exemplo.com.br" } },
    select: { id: true },
  });

  const userIds = demoUsers.map((user) => user.id);

  await prisma.delivery.deleteMany({ where: { deliveredById: { in: userIds } } });
  await prisma.stockReservation.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.delegation.deleteMany({ where: { requestedById: { in: userIds } } });
  await prisma.attachment.deleteMany({ where: { uploadedById: { in: userIds } } });
  await prisma.requestEvent.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.requestLine.deleteMany({ where: { request: { requesterId: { in: userIds } } } });
  await prisma.request.deleteMany({ where: { requesterId: { in: userIds } } });

  await prisma.maintenanceEvent.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.maintenanceRequest.deleteMany({ where: { requesterId: { in: userIds } } });

  await prisma.transferEvent.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.transferLine.deleteMany({ where: { transfer: { createdById: { in: userIds } } } });
  await prisma.transfer.deleteMany({ where: { createdById: { in: userIds } } });

  await prisma.stockLine.deleteMany({ where: { stockDocument: { createdById: { in: userIds } } } });
  await prisma.stockDocument.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.stockLevel.deleteMany({});

  // Alertas de mínimo ficariam repetidos entre execuções.
  await prisma.notification.deleteMany({ where: { type: "STOCK_BELOW_MIN" } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
}

async function main(): Promise<void> {
  console.log("Seed de demonstração do almo-erp\n");

  await resetDemoData();

  const branches = await prisma.branch.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const locations = await prisma.storageLocation.findMany({
    select: { id: true, branchId: true },
  });

  const matrix = branches.find((branch) => branch.code === "MATRIZ");
  const saoPaulo = branches.find((branch) => branch.code === "FIL-SP");
  const rio = branches.find((branch) => branch.code === "FIL-RJ");

  if (!matrix || !saoPaulo || !rio) {
    throw new Error("Rode `pnpm db:seed` antes: as unidades de demonstração não existem.");
  }

  const locationOf = (branchId: string) =>
    locations.find((location) => location.branchId === branchId)?.id ?? "";

  const items = await prisma.item.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      referencePrice: true,
      controlledByLot: true,
      lots: {
        where: { active: true },
        orderBy: { expirationDate: "asc" },
        select: { id: true, expirationDate: true },
      },
    },
  });

  /**
   * Lote a informar na movimentação.
   *
   * Material controlado por lote não pode ser movimentado sem um — regra do
   * motor de estoque. Criamos um lote válido quando o material não tem nenhum.
   */
  async function lotFor(item: (typeof items)[number]): Promise<string | undefined> {
    if (!item.controlledByLot) return undefined;

    const valid = item.lots.find((lot) => !lot.expirationDate || lot.expirationDate > new Date());

    if (valid) return valid.id;

    const created = await prisma.itemLot.create({
      data: {
        itemId: item.id,
        code: "LOTE-DEMO",
        expirationDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        initialQuantity: d(0),
      },
      select: { id: true },
    });

    return created.id;
  }

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@exemplo.com.br" } },
    select: { id: true, email: true, name: true },
  });

  const userByEmail = (local: string) => users.find((user) => user.email.startsWith(`${local}@`));

  /** Item pelo código, falhando com mensagem clara se o seed base não rodou. */
  function itemByCode(code: string) {
    const item = items.find((candidate) => candidate.code === code);

    if (!item) {
      throw new Error(`Material ${code} não encontrado. Rode \`pnpm db:seed\` antes.`);
    }

    return item;
  }

  const admin = userByEmail("admin");
  const adminFilial = userByEmail("admin.filial");
  const gestor = userByEmail("gestor");
  const almoxarife = userByEmail("almoxarife");
  const solicitante = userByEmail("solicitante");

  if (!admin || !adminFilial || !gestor || !almoxarife || !solicitante) {
    throw new Error("Usuários de demonstração não encontrados. Rode `pnpm db:seed`.");
  }

  const allBranchIds = branches.map((branch) => branch.id);

  const contexts = {
    admin: makeContext({
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      branchId: matrix.id,
      permissions: [
        "estoque:entrada",
        "estoque:ajuste",
        "solicitacao:approve",
        "transferencia:enviar",
      ],
      isNetworkScope: true,
      allBranchIds,
    }),
    adminFilial: makeContext({
      userId: adminFilial.id,
      email: adminFilial.email,
      name: adminFilial.name,
      branchId: saoPaulo.id,
      permissions: [
        "estoque:entrada",
        "estoque:ajuste",
        "solicitacao:approve",
        "solicitacao:entregar",
        "transferencia:receber",
      ],
    }),
    gestor: makeContext({
      userId: gestor.id,
      email: gestor.email,
      name: gestor.name,
      branchId: saoPaulo.id,
      permissions: ["solicitacao:approve", "solicitacao:create", "transferencia:receber"],
    }),
    almoxarife: makeContext({
      userId: almoxarife.id,
      email: almoxarife.email,
      name: almoxarife.name,
      branchId: saoPaulo.id,
      permissions: [
        "estoque:entrada",
        "estoque:ajuste",
        "solicitacao:entregar",
        "transferencia:enviar",
      ],
    }),
    solicitante: makeContext({
      userId: solicitante.id,
      email: solicitante.email,
      name: solicitante.name,
      branchId: saoPaulo.id,
      permissions: ["solicitacao:create", "solicitacao:read"],
    }),
  };

  /* ---------------------------------------------------------------------- */
  /* 1. Estoque inicial de cada unidade                                      */
  /* ---------------------------------------------------------------------- */

  console.log("Estoque inicial:");

  const stockPlan: Record<string, Array<{ code: string; quantity: number; cost: number }>> = {
    MATRIZ: [
      { code: "EPI-0001", quantity: 120, cost: 46.5 },
      { code: "EPI-0002", quantity: 200, cost: 11.9 },
      { code: "EPI-0003", quantity: 150, cost: 17.4 },
      { code: "EPI-0005", quantity: 60, cost: 85.0 },
      { code: "LMP-0001", quantity: 300, cost: 4.1 },
      { code: "LMP-0002", quantity: 250, cost: 3.05 },
      { code: "LMP-0003", quantity: 180, cost: 22.1 },
      { code: "ESC-0001", quantity: 40, cost: 27.0 },
      { code: "ESC-0002", quantity: 90, cost: 31.5 },
      { code: "ESC-0003", quantity: 12, cost: 182.0 },
      { code: "CNS-0001", quantity: 60, cost: 18.2 },
      { code: "CNS-0002", quantity: 80, cost: 5.2 },
    ],
    "FIL-SP": [
      // Proposital: capacete e café abaixo do mínimo, para o alerta aparecer.
      { code: "EPI-0001", quantity: 6, cost: 48.0 },
      { code: "EPI-0002", quantity: 85, cost: 12.1 },
      { code: "EPI-0003", quantity: 110, cost: 18.2 },
      { code: "LMP-0001", quantity: 96, cost: 4.29 },
      { code: "LMP-0003", quantity: 120, cost: 22.9 },
      { code: "ESC-0002", quantity: 55, cost: 32.5 },
      { code: "CNS-0001", quantity: 7, cost: 18.9 },
    ],
    "FIL-RJ": [
      { code: "EPI-0001", quantity: 40, cost: 47.5 },
      { code: "EPI-0003", quantity: 70, cost: 18.0 },
      { code: "EPI-0005", quantity: 30, cost: 88.0 },
      { code: "LMP-0001", quantity: 140, cost: 4.2 },
      { code: "LMP-0003", quantity: 90, cost: 22.5 },
      { code: "ESC-0001", quantity: 25, cost: 27.5 },
      { code: "CNS-0001", quantity: 45, cost: 18.5 },
      { code: "CNS-0003", quantity: 60, cost: 7.6 },
    ],
  };

  for (const branch of branches) {
    const plan = stockPlan[branch.code];
    if (!plan) continue;

    const lines = [];

    for (const entry of plan) {
      const item = items.find((candidate) => candidate.code === entry.code);
      if (!item) continue;

      lines.push({
        itemId: item.id,
        quantity: d(entry.quantity),
        unitCost: d(entry.cost),
        itemLotId: await lotFor(item),
      });
    }

    if (lines.length === 0) continue;

    await createAndPostStockDocument({
      type: "INBOUND",
      branchId: branch.id,
      storageLocationId: locationOf(branch.id),
      createdById: admin.id,
      notes: `Carga inicial de demonstração — ${branch.name}`,
      referenceType: "DEMO",
      date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      lines,
    });

    console.log(`  ${branch.code}: ${lines.length} material(is)`);
  }

  /* ---------------------------------------------------------------------- */
  /* 2. Histórico de consumo (para os gráficos)                              */
  /* ---------------------------------------------------------------------- */

  const consumptionPlan: Array<{ daysAgo: number; code: string; quantity: number }> = [
    { daysAgo: 38, code: "LMP-0001", quantity: 20 },
    { daysAgo: 31, code: "EPI-0002", quantity: 8 },
    { daysAgo: 24, code: "LMP-0003", quantity: 15 },
    { daysAgo: 17, code: "EPI-0003", quantity: 12 },
    { daysAgo: 10, code: "CNS-0001", quantity: 6 },
    { daysAgo: 5, code: "LMP-0001", quantity: 18 },
    { daysAgo: 2, code: "ESC-0002", quantity: 4 },
  ];

  let consumptionCount = 0;

  for (const entry of consumptionPlan) {
    const item = items.find((candidate) => candidate.code === entry.code);
    if (!item) continue;

    const level = await prisma.stockLevel.findFirst({
      where: { itemId: item.id, branchId: saoPaulo.id },
      select: { quantity: true },
    });

    if (!level || level.quantity.lessThan(entry.quantity)) continue;

    await createAndPostStockDocument({
      type: "ISSUE",
      branchId: saoPaulo.id,
      storageLocationId: locationOf(saoPaulo.id),
      createdById: almoxarife.id,
      notes: "Consumo de demonstração",
      referenceType: "DEMO",
      date: new Date(Date.now() - entry.daysAgo * 24 * 60 * 60 * 1000),
      lines: [
        {
          itemId: item.id,
          quantity: d(entry.quantity).negated(),
          itemLotId: await lotFor(item),
        },
      ],
    });

    consumptionCount += 1;
  }

  console.log(`  histórico de consumo: ${consumptionCount} saída(s)`);

  /* ---------------------------------------------------------------------- */
  /* 3. Solicitações em estágios diferentes                                  */
  /* ---------------------------------------------------------------------- */

  const limpeza = itemByCode("LMP-0001");
  const oculos = itemByCode("EPI-0002");
  const papelA4 = itemByCode("ESC-0002");
  const capacete = itemByCode("EPI-0001");

  // 3.1 Já entra aguardando aprovação — aparece na fila e no sino do admin.
  await createRequest(
    contexts.solicitante,
    {
      branchId: saoPaulo.id,
      neededAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      notes: "Reposição do estoque de limpeza do andar 3.",
      lines: [
        { itemId: limpeza.id, quantity: "24" },
        { itemId: oculos.id, quantity: "10" },
        { itemId: papelA4.id, quantity: "10" },
      ],
    },
    { ip: "127.0.0.1" },
  );

  // 3.2 Segunda solicitação, também aguardando decisão. A prioridade quem
  // define é o aprovador, ao decidir.
  await createRequest(
    contexts.solicitante,
    {
      branchId: saoPaulo.id,
      notes: "Óculos de proteção para a equipe que entrou hoje.",
      lines: [{ itemId: oculos.id, quantity: "6" }],
    },
    { ip: "127.0.0.1" },
  );

  // 3.3 Aprovada e reservada — aparece em Entregas aguardando o almoxarife.
  const approved = await createRequest(
    contexts.solicitante,
    {
      branchId: saoPaulo.id,
      notes: "Material de escritório do mês.",
      lines: [{ itemId: papelA4.id, quantity: "8" }],
    },
    { ip: "127.0.0.1" },
  );

  const approvedLines = await prisma.requestLine.findMany({
    where: { requestId: approved.id },
    select: { id: true },
  });

  await approveRequest(contexts.gestor, {
    requestId: approved.id,
    priority: "HIGH",
    comment: "Aprovado. Separar no almoxarifado central.",
    lines: approvedLines.map((line) => ({ lineId: line.id, approvedQuantity: "8" })),
  });

  // 3.4 Entregue — histórico e comprovante disponíveis.
  const delivered = await createRequest(
    contexts.solicitante,
    {
      branchId: saoPaulo.id,
      notes: "Material de limpeza da recepção.",
      lines: [{ itemId: limpeza.id, quantity: "6" }],
    },
    { ip: "127.0.0.1" },
  );

  const deliveredLines = await prisma.requestLine.findMany({
    where: { requestId: delivered.id },
    select: { id: true },
  });

  await approveRequest(contexts.gestor, {
    requestId: delivered.id,
    lines: deliveredLines.map((line) => ({ lineId: line.id, approvedQuantity: "6" })),
  });

  await deliverRequest(contexts.almoxarife, {
    requestId: delivered.id,
    receivedByName: "Ana Paula Ribeiro",
    receivedByDocument: "52998224725",
    notes: "Retirado no balcão do almoxarifado.",
    lines: deliveredLines.map((line) => ({ lineId: line.id, deliveredQuantity: "6" })),
  });

  // 3.5 Aprovada parcialmente — mostra o fluxo de divergência com motivo.
  const partial = await createRequest(
    contexts.solicitante,
    {
      branchId: saoPaulo.id,
      notes: "Pedido de capacetes para a equipe nova.",
      lines: [{ itemId: capacete.id, quantity: "20" }],
    },
    { ip: "127.0.0.1" },
  );

  const partialLines = await prisma.requestLine.findMany({
    where: { requestId: partial.id },
    select: { id: true },
  });

  await approveRequest(contexts.gestor, {
    requestId: partial.id,
    comment: "Só temos 6 em estoque; o restante virá por transferência da matriz.",
    lines: partialLines.map((line) => ({
      lineId: line.id,
      approvedQuantity: "6",
      nonApprovalReason: "Saldo insuficiente na unidade; reposição em trânsito.",
    })),
  });

  console.log("  solicitações: 2 aguardando, 1 aprovada, 1 entregue, 1 parcial");

  /* ---------------------------------------------------------------------- */
  /* 4. Transferência em trânsito                                            */
  /* ---------------------------------------------------------------------- */

  const transferItems = [capacete, limpeza];

  const transfer = await createTransfer(
    contexts.admin,
    {
      originBranchId: matrix.id,
      destinationBranchId: saoPaulo.id,
      priority: "HIGH",
      notes: "Reposição de capacetes e material de limpeza para São Paulo.",
      lines: transferItems.map((item) => ({
        itemId: item.id,
        quantity: item.code === "EPI-0001" ? "20" : "40",
      })),
    },
    { ip: "127.0.0.1" },
  );

  await sendTransfer(contexts.admin, transfer.id);

  console.log("  transferências: 1 em trânsito (matriz → São Paulo)");

  /* ---------------------------------------------------------------------- */
  /* 5. Chamados de reparo                                                   */
  /* ---------------------------------------------------------------------- */

  const contextsReparo = {
    adminFilial: makeContext({
      userId: adminFilial.id,
      email: adminFilial.email,
      name: adminFilial.name,
      branchId: saoPaulo.id,
      permissions: ["manutencao:read", "manutencao:create", "manutencao:atender"],
    }),
    solicitante: makeContext({
      userId: solicitante.id,
      email: solicitante.email,
      name: solicitante.name,
      branchId: saoPaulo.id,
      permissions: ["manutencao:read", "manutencao:create"],
    }),
    almoxarife: makeContext({
      userId: almoxarife.id,
      email: almoxarife.email,
      name: almoxarife.name,
      branchId: saoPaulo.id,
      permissions: ["manutencao:read", "manutencao:atender"],
    }),
  };

  // 5.1 Aberto, ainda sem prioridade — é o que a manutenção precisa triar.
  await createMaintenanceRequest(contextsReparo.solicitante, {
    branchId: saoPaulo.id,
    category: "HVAC",
    title: "Ar-condicionado da sala 3 não está gelando",
    description:
      "O aparelho liga, sopra ar mas não gela. Começou ontem à tarde. A sala fica com 30°C por volta das 14h e a equipe está reclamando.",
    location: "Sala 3 — 2º andar",
    assetTag: "PAT-001234",
  });

  // 5.2 Em andamento, com prioridade já definida por quem recebeu.
  const emAndamento = await createMaintenanceRequest(contextsReparo.solicitante, {
    branchId: saoPaulo.id,
    category: "ELECTRICAL",
    title: "Tomada do depósito esquentando",
    description:
      "A tomada onde fica o carregador da empilhadeira está quente ao toque e cheira a queimado. Paramos de usar por precaução.",
    location: "Depósito — fundos",
  });

  await setMaintenancePriority(contextsReparo.adminFilial, {
    requestId: emAndamento.id,
    priority: "URGENT",
    comment: "Risco de incêndio. Atender hoje.",
  });

  await assignMaintenanceRequest(contextsReparo.adminFilial, {
    requestId: emAndamento.id,
    assignedToId: almoxarife.id,
    comment: "Eletricista agendado para hoje à tarde.",
  });

  // 5.3 Concluído — alimenta o histórico e o tempo médio de resolução.
  const concluido = await createMaintenanceRequest(contextsReparo.solicitante, {
    branchId: saoPaulo.id,
    category: "PLUMBING",
    title: "Vazamento na torneira da copa",
    description: "A torneira da pia da copa fica pingando e molha o balcão inteiro.",
    location: "Copa — 1º andar",
  });

  await setMaintenancePriority(contextsReparo.adminFilial, {
    requestId: concluido.id,
    priority: "NORMAL",
  });

  await assignMaintenanceRequest(contextsReparo.adminFilial, {
    requestId: concluido.id,
    assignedToId: almoxarife.id,
  });

  await completeMaintenanceRequest(contextsReparo.almoxarife, {
    requestId: concluido.id,
    resolution: "Substituído o reparo e a vedação. Testado por 30 minutos sem vazamento.",
  });

  console.log("  chamados de reparo: 1 aberto, 1 em andamento, 1 concluído");

  /* ---------------------------------------------------------------------- */

  const summary = await prisma.$transaction([
    prisma.stockLevel.count(),
    prisma.request.count(),
    prisma.transfer.count(),
    prisma.notification.count(),
    prisma.maintenanceRequest.count(),
  ]);

  console.log("\nSeed de demonstração concluído.");
  console.log(
    `  ${summary[0]} saldo(s), ${summary[1]} solicitação(ões), ${summary[2]} transferência(s), ${summary[3]} notificação(ões), ${summary[4]} chamado(s) de reparo`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("\nFalha no seed de demonstração:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
