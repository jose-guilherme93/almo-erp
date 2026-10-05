import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { toCsv, toCsvNumber, type CsvValue } from "@/lib/csv";
import { availableQuantity } from "@/server/services/stock/average-cost";
import type { AuthContext } from "@/server/auth/context";
import { visibleBranchIds } from "@/server/auth/scope";

/**
 * Relatórios.
 *
 * Todo relatório devolve `{ headers, rows }` — assim a mesma consulta alimenta
 * a tela e o CSV, sem duas implementações que possam divergir.
 *
 * Guard `relatorio:read` e escopo por filial são aplicados pelo chamador
 * (page ou route handler) usando `context`.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReportId =
  | "consumo-material"
  | "consumo-solicitante"
  | "valor-estoque"
  | "reposicao"
  | "solicitacoes"
  | "movimentacoes"
  | "sem-movimento"
  | "sem-politica"
  | "demanda-por-setor"
  | "duracao-demandas";

export const REPORTS: Array<{ id: ReportId; label: string; description: string }> = [
  {
    id: "consumo-material",
    label: "Consumo por material",
    description: "Quanto saiu de cada material no período, em quantidade e valor.",
  },
  {
    id: "consumo-solicitante",
    label: "Consumo por solicitante",
    description: "Quem pediu o quê, para dimensionar demanda por setor.",
  },
  {
    id: "valor-estoque",
    label: "Valor de estoque",
    description: "Quanto cada unidade e categoria tem em estoque, a preço médio.",
  },
  {
    id: "reposicao",
    label: "Reposição sugerida",
    description: "Itens abaixo do mínimo, com cobertura estimada em dias.",
  },
  {
    id: "solicitacoes",
    label: "Histórico de solicitações",
    description: "Volume, tempo de aprovação e taxa de rejeição por período.",
  },
  {
    id: "movimentacoes",
    label: "Movimentações",
    description: "Extrato de entradas, saídas e ajustes com o responsável.",
  },
  {
    id: "sem-movimento",
    label: "Estoque sem movimento",
    description: "Itens parados há muito tempo — candidatos a redistribuição.",
  },
  {
    id: "sem-politica",
    label: "Itens sem mínimo definido",
    description: "Materiais sem política de reposição: lacuna silenciosa de configuração.",
  },
  {
    id: "demanda-por-setor",
    label: "Demanda por setor",
    description: "Quais setores pedem mais material e abrem mais chamados, com valor e conclusão.",
  },
  {
    id: "duracao-demandas",
    label: "Duração das demandas",
    description: "Tempo médio e máximo para decidir/atender, mês a mês, por tipo de demanda.",
  },
];

export type ReportResult = {
  headers: string[];
  rows: CsvValue[][];
  /** Resumo curto exibido acima da tabela. */
  summary: string;
};

export function isReportId(value: string): value is ReportId {
  return REPORTS.some((report) => report.id === value);
}

export type ReportScope = {
  from: Date;
  to: Date;
  branchIds: readonly string[];
  categoryId?: string | null;
};

function branchIdsFor(context: AuthContext, requested?: string | null): readonly string[] {
  if (requested && context.branchIds.includes(requested)) return [requested];

  return visibleBranchIds(context);
}

export function buildScope(
  context: AuthContext,
  params: {
    from?: string | null;
    to?: string | null;
    branchId?: string | null;
    categoryId?: string | null;
  },
): ReportScope {
  const from = params.from ? new Date(params.from) : new Date(Date.now() - 30 * MS_PER_DAY);
  const to = params.to ? new Date(`${params.to}T23:59:59`) : new Date();

  return {
    from,
    to,
    branchIds: branchIdsFor(context, params.branchId ?? null),
    categoryId: params.categoryId ?? null,
  };
}

/* -------------------------------------------------------------------------- */

async function consumoMaterial(scope: ReportScope): Promise<ReportResult> {
  const lines = await prisma.stockLine.findMany({
    where: {
      quantity: { lt: 0 },
      createdAt: { gte: scope.from, lte: scope.to },
      stockDocument: { branchId: { in: [...scope.branchIds] }, status: "POSTED" },
      ...(scope.categoryId ? { item: { categoryId: scope.categoryId } } : {}),
    },
    select: {
      quantity: true,
      lineTotal: true,
      item: {
        select: {
          code: true,
          name: true,
          unit: { select: { code: true } },
          category: { select: { name: true } },
        },
      },
    },
  });

  const byItem = new Map<
    string,
    {
      code: string;
      name: string;
      unit: string;
      category: string;
      quantity: Prisma.Decimal;
      value: Prisma.Decimal;
    }
  >();

  for (const line of lines) {
    const key = line.item.code;
    const current = byItem.get(key) ?? {
      code: line.item.code,
      name: line.item.name,
      unit: line.item.unit.code,
      category: line.item.category.name,
      quantity: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
    };

    byItem.set(key, {
      ...current,
      quantity: current.quantity.plus(line.quantity.abs()),
      value: current.value.plus(line.lineTotal),
    });
  }

  const rows = [...byItem.values()]
    .sort((a, b) => b.quantity.comparedTo(a.quantity))
    .map((row) => [
      row.code,
      row.name,
      row.category,
      toCsvNumber(row.quantity.toString()),
      row.unit,
      toCsvNumber(row.value.toString()),
    ]);

  const totalQuantity = [...byItem.values()].reduce(
    (total, row) => total.plus(row.quantity),
    new Prisma.Decimal(0),
  );
  const totalValue = [...byItem.values()].reduce(
    (total, row) => total.plus(row.value),
    new Prisma.Decimal(0),
  );

  return {
    headers: ["Código", "Material", "Categoria", "Quantidade", "Unidade", "Valor (R$)"],
    rows,
    summary: `${byItem.size} material(is) · ${totalQuantity.toString()} em quantidade · R$ ${totalValue.toFixed(2)} em valor`,
  };
}

async function consumoPorSolicitante(scope: ReportScope): Promise<ReportResult> {
  const lines = await prisma.requestLine.findMany({
    where: {
      request: {
        branchId: { in: [...scope.branchIds] },
        status: "DELIVERED",
        deliveredAt: { gte: scope.from, lte: scope.to },
      },
    },
    select: {
      deliveredQuantity: true,
      unitPriceSnapshot: true,
      request: { select: { requester: { select: { name: true, email: true } } } },
    },
  });

  const byRequester = new Map<
    string,
    { name: string; email: string; items: number; quantity: Prisma.Decimal; value: Prisma.Decimal }
  >();

  for (const line of lines) {
    const key = line.request.requester.email;
    const current = byRequester.get(key) ?? {
      name: line.request.requester.name,
      email: key,
      items: 0,
      quantity: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
    };

    byRequester.set(key, {
      ...current,
      items: current.items + 1,
      quantity: current.quantity.plus(line.deliveredQuantity),
      value: current.value.plus(
        line.deliveredQuantity.times(line.unitPriceSnapshot ?? new Prisma.Decimal(0)),
      ),
    });
  }

  const rows = [...byRequester.values()]
    .sort((a, b) => b.quantity.comparedTo(a.quantity))
    .map((row) => [
      row.name,
      row.email,
      row.items,
      toCsvNumber(row.quantity.toString()),
      toCsvNumber(row.value.toString()),
    ]);

  return {
    headers: ["Solicitante", "E-mail", "Itens entregues", "Quantidade", "Valor estimado (R$)"],
    rows,
    summary: `${byRequester.size} solicitante(s) com material entregue no período`,
  };
}

async function valorEstoque(scope: ReportScope): Promise<ReportResult> {
  const levels = await prisma.stockLevel.findMany({
    where: {
      branchId: { in: [...scope.branchIds] },
      ...(scope.categoryId ? { item: { categoryId: scope.categoryId } } : {}),
    },
    select: {
      quantity: true,
      reservedQuantity: true,
      averageCost: true,
      branch: { select: { code: true, name: true } },
      storageLocation: { select: { name: true } },
      item: {
        select: {
          code: true,
          name: true,
          unit: { select: { code: true } },
          category: { select: { name: true } },
        },
      },
    },
  });

  const rows = levels
    .filter((level) => level.quantity.greaterThan(0))
    .map((level) => [
      level.branch.code,
      level.branch.name,
      level.storageLocation.name,
      level.item.code,
      level.item.name,
      level.item.category.name,
      toCsvNumber(availableQuantity(level.quantity, level.reservedQuantity).toString()),
      level.item.unit.code,
      toCsvNumber(level.averageCost.toString()),
      toCsvNumber(level.quantity.times(level.averageCost).toString()),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  const totalValue = levels.reduce(
    (total, level) => total.plus(level.quantity.times(level.averageCost)),
    new Prisma.Decimal(0),
  );

  return {
    headers: [
      "Unidade",
      "Nome da unidade",
      "Local",
      "Código",
      "Material",
      "Categoria",
      "Disponível",
      "Unidade",
      "Custo médio (R$)",
      "Valor total (R$)",
    ],
    rows,
    summary: `${rows.length} registro(s) com saldo · R$ ${totalValue.toFixed(2)} em estoque`,
  };
}

async function reposicao(scope: ReportScope): Promise<ReportResult> {
  // Uma consulta só para as políticas: é delas que sai o "mínimo" de cada
  // material em cada unidade.
  const policies = await prisma.itemStockPolicy.findMany({
    where: {
      branchId: { in: [...scope.branchIds] },
      minimumQuantity: { gt: 0 },
      item: { active: true, ...(scope.categoryId ? { categoryId: scope.categoryId } : {}) },
      branch: { active: true },
    },
    select: {
      branchId: true,
      minimumQuantity: true,
      branch: { select: { code: true, name: true } },
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: { select: { code: true } },
        },
      },
    },
  });

  if (policies.length === 0) {
    return {
      headers: [
        "Unidade",
        "Código",
        "Material",
        "Disponível",
        "Mínimo",
        "Falta",
        "Cobertura (dias)",
      ],
      rows: [],
      summary: "Nenhum material com mínimo definido no escopo.",
    };
  }

  const itemIds = [...new Set(policies.map((policy) => policy.item.id))];

  const [levels, consumptionLines] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { itemId: { in: itemIds }, branchId: { in: [...scope.branchIds] } },
      select: { itemId: true, branchId: true, quantity: true, reservedQuantity: true },
    }),
    // Consumo médio dos últimos 90 dias: a base da cobertura estimada.
    prisma.stockLine.findMany({
      where: {
        quantity: { lt: 0 },
        itemId: { in: itemIds },
        createdAt: { gte: new Date(Date.now() - 90 * MS_PER_DAY) },
        stockDocument: { branchId: { in: [...scope.branchIds] }, status: "POSTED" },
      },
      select: {
        quantity: true,
        itemId: true,
        stockDocument: { select: { branchId: true } },
      },
    }),
  ]);

  const key = (branchId: string, itemId: string) => `${branchId}:${itemId}`;

  const availableByKey = new Map<string, Prisma.Decimal>();

  for (const level of levels) {
    const current = availableByKey.get(key(level.branchId, level.itemId)) ?? new Prisma.Decimal(0);

    availableByKey.set(
      key(level.branchId, level.itemId),
      current.plus(availableQuantity(level.quantity, level.reservedQuantity)),
    );
  }

  const consumptionByKey = new Map<string, Prisma.Decimal>();

  for (const line of consumptionLines) {
    const entryKey = key(line.stockDocument.branchId, line.itemId);
    const current = consumptionByKey.get(entryKey) ?? new Prisma.Decimal(0);

    consumptionByKey.set(entryKey, current.plus(line.quantity.abs()));
  }

  const rows: CsvValue[][] = [];

  for (const policy of policies) {
    const entryKey = key(policy.branchId, policy.item.id);

    const available = availableByKey.get(entryKey) ?? new Prisma.Decimal(0);

    if (available.greaterThanOrEqualTo(policy.minimumQuantity)) continue;

    const consumption90 = consumptionByKey.get(entryKey) ?? new Prisma.Decimal(0);
    const dailyConsumption = consumption90.dividedBy(90);

    const coverageDays = dailyConsumption.greaterThan(0)
      ? available.dividedBy(dailyConsumption).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)
      : null;

    rows.push([
      policy.branch.code,
      policy.branch.name,
      policy.item.code,
      policy.item.name,
      toCsvNumber(available.toString()),
      toCsvNumber(policy.minimumQuantity.toString()),
      toCsvNumber(policy.minimumQuantity.minus(available).toString()),
      policy.item.unit.code,
      coverageDays === null ? "sem consumo" : coverageDays.toString(),
    ]);
  }

  // Mais crítico primeiro: maior falta absoluta.
  rows.sort((a, b) => Number(b[6] ?? 0) - Number(a[6] ?? 0));

  return {
    headers: [
      "Unidade",
      "Nome da unidade",
      "Código",
      "Material",
      "Disponível",
      "Mínimo",
      "Falta",
      "Unidade",
      "Cobertura (dias)",
    ],
    rows,
    summary: `${rows.length} item(ns) abaixo do mínimo`,
  };
}

async function historicoSolicitacoes(scope: ReportScope): Promise<ReportResult> {
  const requests = await prisma.request.findMany({
    where: {
      branchId: { in: [...scope.branchIds] },
      createdAt: { gte: scope.from, lte: scope.to },
    },
    select: {
      number: true,
      status: true,
      priority: true,
      createdAt: true,
      decidedAt: true,
      deliveredAt: true,
      branch: { select: { code: true } },
      requester: { select: { name: true } },
      decidedBy: { select: { name: true } },
      rejectionReason: true,
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = requests.map((request) => {
    const approvalHours = request.decidedAt
      ? (request.decidedAt.getTime() - request.createdAt.getTime()) / (1000 * 60 * 60)
      : null;

    return [
      request.number,
      request.branch.code,
      request.requester.name,
      request.status,
      request.priority,
      request._count.lines,
      request.createdAt.toISOString().slice(0, 10),
      approvalHours === null ? "—" : approvalHours.toFixed(1),
      request.decidedBy?.name ?? "—",
      request.rejectionReason ?? "",
    ];
  });

  const delivered = requests.filter((request) => request.status === "DELIVERED").length;
  const rejected = requests.filter((request) => request.status === "REJECTED").length;
  const approvalTimes = requests
    .filter((request) => request.decidedAt)
    .map((request) =>
      request.decidedAt ? (request.decidedAt.getTime() - request.createdAt.getTime()) / 3600000 : 0,
    );
  const averageHours =
    approvalTimes.length > 0
      ? approvalTimes.reduce((total, hours) => total + hours, 0) / approvalTimes.length
      : null;

  return {
    headers: [
      "Número",
      "Unidade",
      "Solicitante",
      "Situação",
      "Prioridade",
      "Itens",
      "Criada em",
      "Horas até decisão",
      "Decidida por",
      "Motivo da rejeição",
    ],
    rows,
    summary: `${requests.length} solicitação(ões) · ${delivered} entregue(s) · ${rejected} rejeitada(s)${
      averageHours === null ? "" : ` · ${averageHours.toFixed(1)}h em média para decidir`
    }`,
  };
}

async function movimentacoes(scope: ReportScope): Promise<ReportResult> {
  const documents = await prisma.stockDocument.findMany({
    where: {
      branchId: { in: [...scope.branchIds] },
      status: "POSTED",
      date: { gte: scope.from, lte: scope.to },
    },
    orderBy: { date: "desc" },
    select: {
      number: true,
      type: true,
      date: true,
      totalQuantity: true,
      totalCost: true,
      notes: true,
      referenceId: true,
      branch: { select: { code: true } },
      storageLocation: { select: { name: true } },
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });

  const rows = documents.map((document) => [
    document.number,
    document.date.toISOString().slice(0, 10),
    document.branch.code,
    document.type,
    document.storageLocation.name,
    document._count.lines,
    toCsvNumber(document.totalQuantity.toString()),
    toCsvNumber(document.totalCost.toString()),
    document.createdBy.name,
    document.notes ?? "",
  ]);

  const totalCost = documents.reduce(
    (total, document) => total.plus(document.totalCost),
    new Prisma.Decimal(0),
  );

  return {
    headers: [
      "Documento",
      "Data",
      "Unidade",
      "Tipo",
      "Local",
      "Itens",
      "Quantidade",
      "Valor (R$)",
      "Responsável",
      "Observação",
    ],
    rows,
    summary: `${documents.length} lançamento(s) · R$ ${totalCost.toFixed(2)} movimentados`,
  };
}

async function semMovimento(scope: ReportScope): Promise<ReportResult> {
  const cutoff = new Date(Date.now() - 90 * MS_PER_DAY);

  const levels = await prisma.stockLevel.findMany({
    where: {
      branchId: { in: [...scope.branchIds] },
      quantity: { gt: 0 },
      OR: [{ lastMovementAt: null }, { lastMovementAt: { lt: cutoff } }],
      ...(scope.categoryId ? { item: { categoryId: scope.categoryId } } : {}),
    },
    orderBy: { lastMovementAt: "asc" },
    select: {
      quantity: true,
      averageCost: true,
      lastMovementAt: true,
      branch: { select: { code: true } },
      storageLocation: { select: { name: true } },
      item: { select: { code: true, name: true, unit: { select: { code: true } } } },
    },
  });

  const rows = levels.map((level) => [
    level.branch.code,
    level.storageLocation.name,
    level.item.code,
    level.item.name,
    toCsvNumber(level.quantity.toString()),
    level.item.unit.code,
    toCsvNumber(level.quantity.times(level.averageCost).toString()),
    level.lastMovementAt ? level.lastMovementAt.toISOString().slice(0, 10) : "nunca",
  ]);

  const tiedCapital = levels.reduce(
    (total, level) => total.plus(level.quantity.times(level.averageCost)),
    new Prisma.Decimal(0),
  );

  return {
    headers: [
      "Unidade",
      "Local",
      "Código",
      "Material",
      "Quantidade",
      "Unidade",
      "Valor (R$)",
      "Último movimento",
    ],
    rows,
    summary: `${rows.length} registro(s) parados há mais de 90 dias · R$ ${tiedCapital.toFixed(2)} imobilizados`,
  };
}

async function semPolitica(scope: ReportScope): Promise<ReportResult> {
  const items = await prisma.item.findMany({
    where: {
      active: true,
      ...(scope.categoryId ? { categoryId: scope.categoryId } : {}),
      OR: [
        { stockPolicies: { none: { branchId: { in: [...scope.branchIds] } } } },
        { stockPolicies: { some: { branchId: { in: [...scope.branchIds] }, minimumQuantity: 0 } } },
      ],
    },
    orderBy: { name: "asc" },
    select: {
      code: true,
      name: true,
      referencePrice: true,
      category: { select: { name: true } },
      unit: { select: { code: true } },
    },
  });

  const rows = items.map((item) => [
    item.code,
    item.name,
    item.category.name,
    item.unit.code,
    toCsvNumber(item.referencePrice.toString()),
  ]);

  return {
    headers: ["Código", "Material", "Categoria", "Unidade", "Preço de referência (R$)"],
    rows,
    summary: `${items.length} material(is) sem mínimo definido nas unidades do escopo`,
  };
}

/* -------------------------------------------------------------------------- */
/* Observabilidade por setor e duração                                         */
/* -------------------------------------------------------------------------- */

const MATERIAL_DONE_STATUS = "DELIVERED";
const MATERIAL_CLOSED_STATUSES = ["DELIVERED", "REJECTED", "CANCELLED"];
const MAINTENANCE_DONE_STATUS = "DONE";
const MAINTENANCE_OPEN_STATUSES = ["OPEN", "IN_REVIEW", "IN_PROGRESS", "WAITING_PARTS"];

async function demandaPorSetor(scope: ReportScope): Promise<ReportResult> {
  const [requests, maintenance] = await Promise.all([
    prisma.request.findMany({
      where: {
        branchId: { in: [...scope.branchIds] },
        createdAt: { gte: scope.from, lte: scope.to },
      },
      select: {
        status: true,
        sector: { select: { name: true } },
        lines: { select: { requestedQuantity: true, unitPriceSnapshot: true } },
      },
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        branchId: { in: [...scope.branchIds] },
        createdAt: { gte: scope.from, lte: scope.to },
      },
      select: { status: true, sector: { select: { name: true } } },
    }),
  ]);

  type Agg = {
    sector: string;
    type: string;
    total: number;
    open: number;
    done: number;
    value: Prisma.Decimal;
  };

  const map = new Map<string, Agg>();
  const keyOf = (sector: string, type: string) => `${sector}::${type}`;

  for (const request of requests) {
    const sector = request.sector?.name ?? "Sem setor";
    const key = keyOf(sector, "Material");
    const current = map.get(key) ?? {
      sector,
      type: "Material",
      total: 0,
      open: 0,
      done: 0,
      value: new Prisma.Decimal(0),
    };

    const value = request.lines.reduce(
      (total, line) =>
        total.plus(line.requestedQuantity.times(line.unitPriceSnapshot ?? new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );

    map.set(key, {
      ...current,
      total: current.total + 1,
      open: current.open + (MATERIAL_CLOSED_STATUSES.includes(request.status) ? 0 : 1),
      done: current.done + (request.status === MATERIAL_DONE_STATUS ? 1 : 0),
      value: current.value.plus(value),
    });
  }

  for (const ticket of maintenance) {
    const sector = ticket.sector?.name ?? "Sem setor";
    const key = keyOf(sector, "Chamado");
    const current = map.get(key) ?? {
      sector,
      type: "Chamado",
      total: 0,
      open: 0,
      done: 0,
      value: new Prisma.Decimal(0),
    };

    map.set(key, {
      ...current,
      total: current.total + 1,
      open: current.open + (MAINTENANCE_OPEN_STATUSES.includes(ticket.status) ? 1 : 0),
      done: current.done + (ticket.status === MAINTENANCE_DONE_STATUS ? 1 : 0),
    });
  }

  const rows = [...map.values()]
    .sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector))
    .map((row) => [
      row.sector,
      row.type,
      row.total,
      row.open,
      row.done,
      toCsvNumber(row.value.toString()),
    ]);

  const totalDemands = [...map.values()].reduce((total, row) => total + row.total, 0);

  return {
    headers: ["Setor", "Tipo", "Demandas", "Em aberto", "Concluídas", "Valor estimado (R$)"],
    rows,
    summary: `${rows.length} combinação(ões) setor × tipo · ${totalDemands} demanda(s) no período`,
  };
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

async function duracaoDemandas(scope: ReportScope): Promise<ReportResult> {
  const [requests, maintenance, delegations] = await Promise.all([
    prisma.request.findMany({
      where: {
        branchId: { in: [...scope.branchIds] },
        createdAt: { gte: scope.from, lte: scope.to },
      },
      select: { createdAt: true, decidedAt: true, deliveredAt: true },
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        branchId: { in: [...scope.branchIds] },
        createdAt: { gte: scope.from, lte: scope.to },
      },
      select: { createdAt: true, completedAt: true },
    }),
    prisma.delegation.findMany({
      where: {
        createdAt: { gte: scope.from, lte: scope.to },
        OR: [
          { request: { branchId: { in: [...scope.branchIds] } } },
          { maintenanceRequest: { branchId: { in: [...scope.branchIds] } } },
        ],
      },
      select: { createdAt: true, completedAt: true },
    }),
  ]);

  type Bucket = { month: string; type: string; total: number; durations: number[] };

  const buckets = new Map<string, Bucket>();

  const push = (month: string, type: string, hours: number | null) => {
    const key = `${month}::${type}`;
    const bucket = buckets.get(key) ?? { month, type, total: 0, durations: [] };

    bucket.total += 1;
    if (hours !== null && Number.isFinite(hours)) bucket.durations.push(hours);

    buckets.set(key, bucket);
  };

  const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3600000;

  for (const request of requests) {
    const end = request.deliveredAt ?? request.decidedAt;
    push(
      monthKey(request.createdAt),
      "Material",
      end ? hoursBetween(request.createdAt, end) : null,
    );
  }

  for (const ticket of maintenance) {
    push(
      monthKey(ticket.createdAt),
      "Chamado",
      ticket.completedAt ? hoursBetween(ticket.createdAt, ticket.completedAt) : null,
    );
  }

  for (const delegation of delegations) {
    push(
      monthKey(delegation.createdAt),
      "Etapa em outro setor",
      delegation.completedAt ? hoursBetween(delegation.createdAt, delegation.completedAt) : null,
    );
  }

  const rows = [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.type.localeCompare(b.type))
    .map((bucket) => {
      const average =
        bucket.durations.length > 0
          ? bucket.durations.reduce((total, value) => total + value, 0) / bucket.durations.length
          : null;
      const maximum = bucket.durations.length > 0 ? Math.max(...bucket.durations) : null;

      return [
        bucket.month,
        bucket.type,
        bucket.total,
        bucket.durations.length,
        average === null ? "—" : average.toFixed(1),
        maximum === null ? "—" : maximum.toFixed(1),
      ];
    });

  const allDurations = [...buckets.values()].flatMap((bucket) => bucket.durations);
  const overallAverage =
    allDurations.length > 0
      ? allDurations.reduce((total, value) => total + value, 0) / allDurations.length
      : null;

  return {
    headers: [
      "Competência",
      "Tipo",
      "Demandas",
      "Concluídas",
      "Tempo médio (h)",
      "Tempo máximo (h)",
    ],
    rows,
    summary:
      overallAverage === null
        ? "Sem demandas concluídas no período."
        : `Tempo médio geral de ${overallAverage.toFixed(1)}h entre abertura e fechamento`,
  };
}

/** Despacha para o relatório pedido. */
export async function runReport(reportId: ReportId, scope: ReportScope): Promise<ReportResult> {
  switch (reportId) {
    case "consumo-material":
      return consumoMaterial(scope);
    case "consumo-solicitante":
      return consumoPorSolicitante(scope);
    case "valor-estoque":
      return valorEstoque(scope);
    case "reposicao":
      return reposicao(scope);
    case "solicitacoes":
      return historicoSolicitacoes(scope);
    case "movimentacoes":
      return movimentacoes(scope);
    case "sem-movimento":
      return semMovimento(scope);
    case "sem-politica":
      return semPolitica(scope);
    case "demanda-por-setor":
      return demandaPorSetor(scope);
    case "duracao-demandas":
      return duracaoDemandas(scope);
  }
}

/** Serializa o resultado para CSV. */
export function reportToCsv(result: ReportResult): string {
  return toCsv(result.headers, result.rows);
}

/** Relatórios que fazem sentido com filtro de categoria. */
export function reportSupportsCategory(reportId: ReportId): boolean {
  return [
    "consumo-material",
    "valor-estoque",
    "reposicao",
    "sem-movimento",
    "sem-politica",
  ].includes(reportId);
}
