/**
 * Seed idempotente do almo-erp.
 *
 * Regras (FASE 01.8):
 *   - usa SOMENTE `upsert` — rodar duas vezes não duplica nada
 *   - não cria saldo nem movimentação de estoque (isso é da FASE 06)
 *   - usuários de demonstração só fora de produção
 *
 * Executado por `pnpm db:seed` (configurado em `migrations.seed` do
 * prisma.config.ts).
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { PASSWORD_MIN_LENGTH, hashPassword, isAcceptablePassword } from "../src/lib/password";
import { PERMISSIONS } from "../src/lib/permissions/catalog";
import { ROLES, permissionsForRole } from "../src/lib/permissions/matrix";
import { DEFAULT_LOCATION_CODE, DEFAULT_LOCATION_NAME } from "../src/server/services/branch";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL não definida. Copie .env.example para .env.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Decide se os dados de demonstração entram:
 *   SEED_DEMO_DATA=true   → força (preview/staging)
 *   SEED_DEMO_DATA=false  → nunca
 *   ausente               → demo só fora de produção (padrão de dev e CI)
 *
 * É uma decisão **explícita**, e não o `NODE_ENV`: dentro do container o
 * `NODE_ENV` é sempre `production`, então um preview com demo precisa pedir.
 */
function resolveSeedDemoData(): boolean {
  const flag = (process.env["SEED_DEMO_DATA"] ?? "").trim().toLowerCase();

  if (flag === "true") return true;
  if (flag === "false") return false;

  return process.env["NODE_ENV"] !== "production";
}

const seedDemoData = resolveSeedDemoData();

// -----------------------------------------------------------------------------
// Dados de referência
// -----------------------------------------------------------------------------

const UNITS = [
  { code: "UN", name: "Unidade", allowsDecimals: false },
  { code: "CX", name: "Caixa", allowsDecimals: false },
  { code: "PCT", name: "Pacote", allowsDecimals: false },
  { code: "RL", name: "Rolo", allowsDecimals: false },
  { code: "DZ", name: "Dúzia", allowsDecimals: false },
  { code: "FD", name: "Fardo", allowsDecimals: false },
  { code: "KG", name: "Quilograma", allowsDecimals: true },
  { code: "L", name: "Litro", allowsDecimals: true },
  { code: "M", name: "Metro", allowsDecimals: true },
] as const;

const CATEGORIES = [
  {
    code: "EPI",
    name: "Equipamento de proteção individual",
    requiresApproval: true,
    parent: null,
  },
  {
    code: "EPI-CABECA",
    name: "Proteção da cabeça",
    requiresApproval: true,
    parent: "EPI",
  },
  {
    code: "EPI-MAOS",
    name: "Proteção das mãos",
    requiresApproval: true,
    parent: "EPI",
  },
  {
    code: "LIMPEZA",
    name: "Limpeza e higiene",
    requiresApproval: false,
    parent: null,
  },
  {
    code: "ESCRITORIO",
    name: "Material de escritório",
    requiresApproval: false,
    parent: null,
  },
  {
    code: "CONSUMO",
    name: "Copa e consumo",
    requiresApproval: false,
    parent: null,
  },
] as const;

const ITEMS = [
  // EPI — proteção da cabeça
  {
    code: "EPI-0001",
    barcode: "7891234500014",
    name: "Capacete de segurança classe B",
    categoryCode: "EPI-CABECA",
    unitCode: "UN",
    referencePrice: "48.90",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-SP": "10", MATRIZ: "20" },
  },
  {
    code: "EPI-0002",
    barcode: "7891234500021",
    name: "Óculos de proteção incolor",
    categoryCode: "EPI-CABECA",
    unitCode: "UN",
    referencePrice: "12.50",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-SP": "15" },
  },
  // EPI — proteção das mãos
  {
    code: "EPI-0003",
    barcode: "7891234500038",
    name: "Luva de vaqueta reforçada",
    categoryCode: "EPI-MAOS",
    unitCode: "PAR",
    referencePrice: "18.75",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-SP": "20", "FIL-RJ": "20" },
  },
  {
    code: "EPI-0004",
    barcode: "7891234500045",
    name: "Luva nitrílica descartável",
    categoryCode: "EPI-MAOS",
    unitCode: "CX",
    referencePrice: "42.00",
    controlledByLot: true,
    perishable: true,
    minimums: { MATRIZ: "5" },
  },
  {
    code: "EPI-0005",
    barcode: "7891234500052",
    name: "Bota de segurança couro com biqueira",
    categoryCode: "EPI",
    unitCode: "PAR",
    referencePrice: "89.90",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-RJ": "6" },
  },
  // Limpeza
  {
    code: "LMP-0001",
    barcode: "7891234500069",
    name: "Água sanitária 1 litro",
    categoryCode: "LIMPEZA",
    unitCode: "UN",
    referencePrice: "4.29",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-SP": "24", "FIL-RJ": "24", MATRIZ: "48" },
  },
  {
    code: "LMP-0002",
    barcode: "7891234500076",
    name: "Detergente neutro 500 ml",
    categoryCode: "LIMPEZA",
    unitCode: "UN",
    referencePrice: "3.19",
    controlledByLot: false,
    perishable: false,
    minimums: {},
  },
  {
    code: "LMP-0003",
    barcode: "7891234500083",
    name: "Papel higiênico 30 metros",
    categoryCode: "LIMPEZA",
    unitCode: "PCT",
    referencePrice: "22.90",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-SP": "30" },
  },
  {
    code: "LMP-0004",
    barcode: "7891234500090",
    name: "Saco de lixo 100 litros",
    categoryCode: "LIMPEZA",
    unitCode: "PCT",
    referencePrice: "16.40",
    controlledByLot: false,
    perishable: false,
    minimums: {},
  },
  // Escritório
  {
    code: "ESC-0001",
    barcode: "7891234500106",
    name: "Caneta esferográfica azul",
    categoryCode: "ESCRITORIO",
    unitCode: "CX",
    referencePrice: "28.00",
    controlledByLot: false,
    perishable: false,
    minimums: { MATRIZ: "10" },
  },
  {
    code: "ESC-0002",
    barcode: "7891234500113",
    name: "Papel A4 75g 500 folhas",
    categoryCode: "ESCRITORIO",
    unitCode: "FD",
    referencePrice: "32.50",
    controlledByLot: false,
    perishable: false,
    minimums: { "FIL-SP": "20", "FIL-RJ": "20", MATRIZ: "40" },
  },
  {
    code: "ESC-0003",
    barcode: "7891234500120",
    name: "Toner HP 26A preto",
    categoryCode: "ESCRITORIO",
    unitCode: "UN",
    referencePrice: "189.00",
    controlledByLot: false,
    perishable: false,
    minimums: { MATRIZ: "2" },
  },
  // Copa e consumo
  {
    code: "CNS-0001",
    barcode: "7891234500137",
    name: "Café torrado e moído 500 g",
    categoryCode: "CONSUMO",
    unitCode: "PCT",
    referencePrice: "18.90",
    controlledByLot: true,
    perishable: true,
    minimums: { "FIL-SP": "12", "FIL-RJ": "12", MATRIZ: "20" },
  },
  {
    code: "CNS-0002",
    barcode: "7891234500144",
    name: "Açúcar refinado 1 kg",
    categoryCode: "CONSUMO",
    unitCode: "UN",
    referencePrice: "5.49",
    controlledByLot: true,
    perishable: true,
    minimums: {},
  },
  {
    code: "CNS-0003",
    barcode: "7891234500151",
    name: "Copo descartável 200 ml",
    categoryCode: "CONSUMO",
    unitCode: "PCT",
    referencePrice: "7.80",
    controlledByLot: false,
    perishable: false,
    minimums: {},
  },
] as const;

const SECTORS = [
  { code: "FINANCEIRO", name: "Financeiro", kind: "REQUESTER" as const },
  { code: "PEDAGOGICO", name: "Pedagógico", kind: "REQUESTER" as const },
  { code: "RH", name: "Recursos Humanos", kind: "REQUESTER" as const },
  { code: "ALMOXARIFADO", name: "Almoxarifado", kind: "SERVICE" as const },
  { code: "MANUTENCAO", name: "Manutenção", kind: "SERVICE" as const },
  { code: "TI", name: "Tecnologia da Informação", kind: "BOTH" as const },
] as const;

const BRANCHES = [
  {
    code: "MATRIZ",
    name: "Matriz",
    type: "MATRIX" as const,
    cnpj: "12345678000195",
    city: "São Paulo",
    state: "SP",
    district: "Centro",
    street: "Avenida Paulista",
    number: "1000",
    zipCode: "01310100",
  },
  {
    code: "FIL-SP",
    name: "Unidade São Paulo — Zona Sul",
    type: "BRANCH" as const,
    cnpj: "12345678000276",
    city: "São Paulo",
    state: "SP",
    district: "Santo Amaro",
    street: "Avenida João Dias",
    number: "450",
    zipCode: "04724000",
  },
  {
    code: "FIL-RJ",
    name: "Unidade Rio de Janeiro",
    type: "BRANCH" as const,
    cnpj: "12345678000357",
    city: "Rio de Janeiro",
    state: "RJ",
    district: "Botafogo",
    street: "Rua Voluntários da Pátria",
    number: "220",
    zipCode: "22270180",
  },
] as const;

const CONFIGS = [
  {
    key: "app.name",
    value: "almo-erp",
    description: "Nome exibido na interface.",
  },
  {
    key: "email.contato",
    value: "ti@exemplo.com.br",
    description: "Contato exibido nas telas de acesso negado e erro.",
  },
  {
    key: "sla.approvalHours",
    value: 24,
    description: "Horas antes de uma solicitação ser marcada como SLA em risco.",
  },
  {
    key: "stock.belowMinDedupDays",
    value: 7,
    description: "Janela de deduplicação do alerta de estoque abaixo do mínimo.",
  },
  {
    key: "request.matrixApprovalThreshold",
    value: "1000.00",
    description: "Valor estimado (BRL) a partir do qual a solicitação exige aprovação da matriz.",
  },
  {
    key: "auth.localLogin.enabled",
    value: true,
    description: "Permite entrar com e-mail e senha, sem Google.",
  },
  {
    key: "auth.google.enabled",
    value: false,
    description: 'Mostra o botão "Entrar com Google". Exige credencial configurada.',
  },
] as const;

// -----------------------------------------------------------------------------
// Seed
// -----------------------------------------------------------------------------

async function seedPermissionsAndRoles(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { id: permission.key },
      update: {
        resource: permission.resource,
        action: permission.action,
        group: permission.group,
        description: permission.description,
      },
      create: {
        id: permission.key,
        resource: permission.resource,
        action: permission.action,
        group: permission.group,
        description: permission.description,
      },
    });
  }

  console.log(`  permissões: ${PERMISSIONS.length}`);

  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { slug: role.slug },
      update: {
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: true,
        active: true,
      },
      create: {
        slug: role.slug,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: true,
      },
    });

    const expected = permissionsForRole(role.slug);

    // Recria apenas as divergências para manter o seed idempotente.
    await prisma.rolePermission.deleteMany({
      where: { roleId: saved.id, permissionId: { notIn: [...expected] } },
    });

    await prisma.rolePermission.createMany({
      data: expected.map((permissionId) => ({ roleId: saved.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log(`  papéis: ${ROLES.length}`);
}

async function seedSectors(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  for (const sector of SECTORS) {
    const saved = await prisma.sector.upsert({
      where: { code: sector.code },
      update: { name: sector.name, kind: sector.kind, active: true },
      create: { code: sector.code, name: sector.name, kind: sector.kind },
    });

    ids[sector.code] = saved.id;
  }

  console.log(`  setores: ${SECTORS.length}`);

  return ids;
}

async function seedCompany(): Promise<void> {
  await prisma.company.upsert({
    where: { cnpj: "12345678000195" },
    update: { legalName: "Almo ERP Demonstração LTDA", tradeName: "Almo ERP" },
    create: {
      legalName: "Almo ERP Demonstração LTDA",
      tradeName: "Almo ERP",
      cnpj: "12345678000195",
    },
  });
}

async function seedBranches(): Promise<Record<string, string>> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { cnpj: "12345678000195" },
  });

  const ids: Record<string, string> = {};

  for (const branch of BRANCHES) {
    const saved = await prisma.branch.upsert({
      where: { code: branch.code },
      update: {
        name: branch.name,
        type: branch.type,
        city: branch.city,
        state: branch.state,
        district: branch.district,
        street: branch.street,
        number: branch.number,
        zipCode: branch.zipCode,
        companyId: company.id,
        active: true,
      },
      create: {
        code: branch.code,
        name: branch.name,
        type: branch.type,
        cnpj: branch.cnpj,
        legalName: `Almo ERP Demonstração LTDA — ${branch.name}`,
        tradeName: branch.name,
        companyId: company.id,
        zipCode: branch.zipCode,
        street: branch.street,
        number: branch.number,
        district: branch.district,
        city: branch.city,
        state: branch.state,
      },
    });

    ids[branch.code] = saved.id;

    await prisma.storageLocation.upsert({
      where: { branchId_code: { branchId: saved.id, code: DEFAULT_LOCATION_CODE } },
      update: { name: DEFAULT_LOCATION_NAME, active: true },
      create: {
        branchId: saved.id,
        code: DEFAULT_LOCATION_CODE,
        name: DEFAULT_LOCATION_NAME,
        type: "MAIN_WAREHOUSE",
        description: "Local principal de guarda e distribuição de materiais.",
      },
    });
  }

  console.log(`  filiais: ${BRANCHES.length} (com almoxarifado central)`);

  return ids;
}

async function seedUnits(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  // "PAR" é usado pelos EPIs de par (luvas/botas) mas não está na lista base.
  const all = [...UNITS, { code: "PAR", name: "Par", allowsDecimals: false }];

  for (const unit of all) {
    const saved = await prisma.unit.upsert({
      where: { code: unit.code },
      update: { name: unit.name, allowsDecimals: unit.allowsDecimals },
      create: {
        code: unit.code,
        name: unit.name,
        allowsDecimals: unit.allowsDecimals,
        isSystem: true,
      },
    });

    ids[unit.code] = saved.id;
  }

  console.log(`  unidades de medida: ${all.length}`);

  return ids;
}

async function seedCategories(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  // Ordenado para que o pai exista antes do filho.
  for (const category of CATEGORIES) {
    const parentId = category.parent ? ids[category.parent] : null;

    const saved = await prisma.category.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        requiresApproval: category.requiresApproval,
        parentId,
      },
      create: {
        code: category.code,
        name: category.name,
        requiresApproval: category.requiresApproval,
        parentId,
      },
    });

    ids[category.code] = saved.id;
  }

  console.log(`  categorias: ${CATEGORIES.length}`);

  return ids;
}

async function seedItems(
  categoryIds: Record<string, string>,
  unitIds: Record<string, string>,
  branchIds: Record<string, string>,
): Promise<void> {
  let policyCount = 0;

  for (const item of ITEMS) {
    const categoryId = categoryIds[item.categoryCode];
    const unitId = unitIds[item.unitCode];

    if (!categoryId || !unitId) {
      throw new Error(`Seed de item ${item.code}: categoria ou unidade inexistente.`);
    }

    const saved = await prisma.item.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        barcode: item.barcode,
        categoryId,
        unitId,
        referencePrice: item.referencePrice,
        controlledByLot: item.controlledByLot,
        perishable: item.perishable,
        active: true,
      },
      create: {
        code: item.code,
        barcode: item.barcode,
        name: item.name,
        categoryId,
        unitId,
        referencePrice: item.referencePrice,
        controlledByLot: item.controlledByLot,
        perishable: item.perishable,
        requiresApproval:
          CATEGORIES.find((c) => c.code === item.categoryCode)?.requiresApproval ?? false,
      },
    });

    for (const [branchCode, minimum] of Object.entries(item.minimums)) {
      const branchId = branchIds[branchCode];

      if (!branchId) {
        throw new Error(`Seed de política: filial ${branchCode} não encontrada.`);
      }

      await prisma.itemStockPolicy.upsert({
        where: { itemId_branchId: { itemId: saved.id, branchId } },
        update: { minimumQuantity: minimum },
        create: { itemId: saved.id, branchId, minimumQuantity: minimum },
      });

      policyCount += 1;
    }

    if (item.controlledByLot) {
      await prisma.itemLot.upsert({
        where: { itemId_code: { itemId: saved.id, code: "LOTE-INICIAL" } },
        update: {},
        create: {
          itemId: saved.id,
          code: "LOTE-INICIAL",
          initialQuantity: 0,
          active: true,
        },
      });
    }
  }

  console.log(`  materiais: ${ITEMS.length}`);
  console.log(`  políticas de mínimo: ${policyCount}`);
}

async function seedEmailPolicy(branchIds: Record<string, string>): Promise<void> {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { slug: "SOLICITANTE" } });
  const domains = (process.env["AUTH_ALLOWED_DOMAINS"] ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  if (domains.length === 0) {
    console.log("  políticas de e-mail: nenhuma (AUTH_ALLOWED_DOMAINS vazio)");
    return;
  }

  for (const domain of domains) {
    await prisma.emailPolicy.upsert({
      where: { domain },
      update: { active: true, defaultRoleId: adminRole.id, defaultBranchId: branchIds["MATRIZ"] },
      create: {
        domain,
        autoApprove: false,
        defaultRoleId: adminRole.id,
        defaultBranchId: branchIds["MATRIZ"],
        active: true,
      },
    });
  }

  console.log(`  políticas de e-mail: ${domains.join(", ")}`);
}

async function seedAdmin(branchIds: Record<string, string>): Promise<void> {
  const email = (process.env["SEED_ADMIN_EMAIL"] ?? "").trim().toLowerCase();
  const name = process.env["SEED_ADMIN_NAME"] ?? "Administrador da Matriz";
  const password = (process.env["SEED_ADMIN_PASSWORD"] ?? "").trim();
  const resetPassword = ["1", "true", "yes", "on"].includes(
    (process.env["SEED_ADMIN_RESET_PASSWORD"] ?? "").toLowerCase(),
  );

  if (!email) {
    console.log("  usuário administrador: não criado (SEED_ADMIN_EMAIL vazio)");
    return;
  }

  if (password.length > 0 && !isAcceptablePassword(password)) {
    throw new Error(
      `Seed: SEED_ADMIN_PASSWORD precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { slug: "SUPER_ADMIN" } });
  const matrixId = branchIds["MATRIZ"];

  if (!matrixId) {
    throw new Error("Seed: filial MATRIZ não encontrada para vincular o administrador.");
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { passwordHash: true },
  });

  // Só grava a senha no primeiro seed ou quando o reset é pedido — assim o
  // seed (idempotente) nunca sobrescreve uma senha trocada depois.
  const shouldSetPassword = password.length > 0 && (!existing?.passwordHash || resetPassword);
  const passwordHash = shouldSetPassword ? await hashPassword(password) : undefined;

  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, status: "ACTIVE", active: true, ...(passwordHash ? { passwordHash } : {}) },
    create: {
      email,
      name,
      status: "ACTIVE",
      approvedAt: new Date(),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_branchId_roleId: { userId: admin.id, branchId: matrixId, roleId: role.id },
    },
    update: { active: true, isDefault: true },
    create: {
      userId: admin.id,
      branchId: matrixId,
      roleId: role.id,
      isDefault: true,
      active: true,
    },
  });

  const passwordNote = passwordHash
    ? " com senha local"
    : existing?.passwordHash
      ? " (senha local preservada)"
      : " (sem senha local)";

  console.log(`  administrador: ${email} (SUPER_ADMIN na matriz)${passwordNote}`);
}

async function seedDemoUsers(
  branchIds: Record<string, string>,
  sectorIds: Record<string, string>,
): Promise<void> {
  if (!seedDemoData) {
    console.log("  usuários de demonstração: desligados (SEED_DEMO_DATA)");
    return;
  }

  const domain = (process.env["AUTH_ALLOWED_DOMAINS"] ?? "exemplo.com.br").split(",")[0]?.trim();

  if (!domain) return;

  // Senha dos usuários de demonstração: sem ela eles não teriam como entrar no
  // preview (o login é local, por e-mail + senha).
  const demoPassword = (process.env["SEED_DEMO_PASSWORD"] ?? "demo-senha-1234").trim();

  if (demoPassword.length > 0 && !isAcceptablePassword(demoPassword)) {
    throw new Error(
      `Seed: SEED_DEMO_PASSWORD precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }

  const demoPasswordHash = demoPassword.length > 0 ? await hashPassword(demoPassword) : undefined;

  const demo = [
    {
      local: "admin.filial",
      name: "Administrador da Unidade SP",
      role: "ADMIN_FILIAL",
      branch: "FIL-SP",
      sector: "FINANCEIRO",
    },
    {
      local: "gestor",
      name: "Gestor de Aprovações",
      role: "GESTOR",
      branch: "FIL-SP",
      sector: "RH",
    },
    {
      local: "almoxarife",
      name: "Almoxarife SP",
      role: "ALMOXARIFE",
      branch: "FIL-SP",
      sector: "ALMOXARIFADO",
    },
    {
      local: "ti",
      name: "Técnico de TI",
      role: "TI",
      branch: "FIL-SP",
      sector: "TI",
    },
    {
      local: "solicitante",
      name: "Colaborador Solicitante",
      role: "SOLICITANTE",
      branch: "FIL-SP",
      sector: "PEDAGOGICO",
    },
    {
      local: "consulta",
      name: "Usuário Consulta",
      role: "CONSULTA",
      branch: "FIL-RJ",
      sector: "RH",
    },
  ] as const;

  for (const entry of demo) {
    const email = `${entry.local}@${domain}`;
    const role = await prisma.role.findUniqueOrThrow({ where: { slug: entry.role } });
    const branchId = branchIds[entry.branch];
    const sectorId = sectorIds[entry.sector];

    if (!branchId) continue;

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name: entry.name,
        status: "ACTIVE",
        active: true,
        ...(demoPasswordHash ? { passwordHash: demoPasswordHash } : {}),
      },
      create: {
        email,
        name: entry.name,
        status: "ACTIVE",
        approvedAt: new Date(),
        ...(demoPasswordHash ? { passwordHash: demoPasswordHash } : {}),
      },
    });

    await prisma.membership.upsert({
      where: {
        userId_branchId_roleId: { userId: user.id, branchId, roleId: role.id },
      },
      update: { active: true, isDefault: true, sectorId },
      create: {
        userId: user.id,
        branchId,
        roleId: role.id,
        sectorId,
        isDefault: true,
        active: true,
      },
    });
  }

  console.log(
    `  usuários de demonstração: ${demo.length}${demoPasswordHash ? " (com senha de demo)" : ""}`,
  );
}

async function seedConfigs(): Promise<void> {
  for (const config of CONFIGS) {
    await prisma.config.upsert({
      where: { key: config.key },
      update: { description: config.description },
      create: { key: config.key, value: config.value, description: config.description },
    });
  }

  console.log(`  configurações: ${CONFIGS.length}`);
}

/**
 * Bootstrap de produção: garante a matriz e o almoxarifado central sem os dados
 * de demonstração. Não sobrescreve nada que o administrador já tenha editado —
 * o resto (empresa, filiais, catálogo, setores de negócio) é cadastrado na UI.
 */
async function seedProductionBootstrap(): Promise<Record<string, string>> {
  const matrix = await prisma.branch.upsert({
    where: { code: "MATRIZ" },
    update: {},
    create: { code: "MATRIZ", name: "Matriz", type: "MATRIX" },
  });

  await prisma.storageLocation.upsert({
    where: { branchId_code: { branchId: matrix.id, code: "ALMOX" } },
    update: {},
    create: {
      branchId: matrix.id,
      code: "ALMOX",
      name: "Almoxarifado Central",
      type: "MAIN_WAREHOUSE",
      description: "Local principal de guarda e distribuição de materiais.",
    },
  });

  console.log("  filial matriz garantida (sem dados de demonstração)");

  return { MATRIZ: matrix.id };
}

/** Só no ambiente de demonstração: liga responsáveis das filiais aos usuários de demo. */
async function linkDemoResponsibles(branchIds: Record<string, string>): Promise<void> {
  const domain = (process.env["AUTH_ALLOWED_DOMAINS"] ?? "exemplo.com.br").split(",")[0]?.trim();

  const almoxarife = await prisma.user.findUnique({
    where: { email: `almoxarife@${domain}` },
  });
  const gestor = await prisma.user.findUnique({ where: { email: `gestor@${domain}` } });

  if (!almoxarife && !gestor) return;

  for (const code of ["MATRIZ", "FIL-SP", "FIL-RJ"]) {
    const branchId = branchIds[code];
    if (!branchId) continue;

    await prisma.branch.update({
      where: { id: branchId },
      data: {
        ...(almoxarife ? { warehouseResponsibleId: almoxarife.id } : {}),
        ...(gestor ? { notificationResponsibleId: gestor.id, defaultApproverId: gestor.id } : {}),
      },
    });
  }
}

async function main(): Promise<void> {
  console.log("Seed do almo-erp\n");

  // Dados de referência: existem em qualquer ambiente (o sistema não funciona
  // sem permissões, papéis, unidades, setores e configurações).
  await seedPermissionsAndRoles();
  const unitIds = await seedUnits();
  const sectorIds = await seedSectors();
  await seedConfigs();

  if (!seedDemoData) {
    // Sem demo (produção): só o essencial. Nada de empresa, filial, catálogo ou
    // usuário de demonstração — isso é criado pelo administrador na interface.
    const branchIds = await seedProductionBootstrap();
    await seedEmailPolicy(branchIds);
    await seedAdmin(branchIds);

    console.log("\nSeed concluído (produção: referência + matriz + administrador).");
    return;
  }

  // Desenvolvimento e testes: dados de demonstração completos.
  await seedCompany();
  const branchIds = await seedBranches();
  const categoryIds = await seedCategories();
  await seedItems(categoryIds, unitIds, branchIds);
  await seedEmailPolicy(branchIds);
  await seedAdmin(branchIds);
  await seedDemoUsers(branchIds, sectorIds);
  await linkDemoResponsibles(branchIds);

  console.log("\nSeed concluído.");
}

main()
  .catch((error: unknown) => {
    console.error("\nFalha no seed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
