/**
 * Testes de integração do provisionamento de login.
 *
 * Rodam contra o banco de verdade porque é aqui que a regra de acesso se
 * materializa (domínio + política + status do usuário + convite).
 *
 * Usam domínios próprios (`teste.integracao.local` e `pendente.integracao.local`)
 * para não interferir nos dados do seed. Todo dado criado é removido no fim.
 *
 * Se o banco não estiver acessível, a suíte é pulada em vez de falhar.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { provisionUserOnLogin } from "@/server/auth/provisioning";

const TEST_DOMAIN = "teste.integracao.local";
const PATTERN_DOMAIN = "pendente.integracao.local";
const ADMIN_EMAIL = "aguardando@teste.integracao.local";

let databaseAvailable = false;
let matrixBranchId = "";
let solicitanteRoleId = "";
let adminRoleId = "";
let adminUserId = "";

const ALL_DOMAINS = [TEST_DOMAIN, PATTERN_DOMAIN];

/** Garante uma política no estado desejado para o domínio de teste. */
async function configurePolicy(
  domain: string,
  overrides: { autoApprove?: boolean; pattern?: string | null; active?: boolean } = {},
): Promise<void> {
  const data = {
    autoApprove: overrides.autoApprove ?? false,
    pattern: overrides.pattern ?? null,
    active: overrides.active ?? true,
    defaultRoleId: solicitanteRoleId,
    defaultBranchId: matrixBranchId,
  };

  await prisma.emailPolicy.upsert({
    where: { domain },
    update: data,
    create: { domain, ...data },
  });
}

async function cleanupTestData(): Promise<void> {
  // Remove tudo que os testes criam, nos dois domínios de teste.
  for (const domain of ALL_DOMAINS) {
    const byEmail = { email: { endsWith: `@${domain}` } };

    await prisma.invite.deleteMany({ where: byEmail });
    await prisma.user.deleteMany({ where: byEmail });
  }
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
    where: { type: "MATRIX", active: true },
    select: { id: true },
  });
  const solicitante = await prisma.role.findUnique({
    where: { slug: "SOLICITANTE" },
    select: { id: true },
  });
  const adminFilial = await prisma.role.findUnique({
    where: { slug: "ADMIN_FILIAL" },
    select: { id: true },
  });
  const actor = await prisma.user.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  if (!matrix || !solicitante || !adminFilial || !actor) {
    databaseAvailable = false;
    return;
  }

  matrixBranchId = matrix.id;
  solicitanteRoleId = solicitante.id;
  adminRoleId = adminFilial.id;
  adminUserId = actor.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await cleanupTestData();
  await configurePolicy(TEST_DOMAIN);
  await prisma.emailPolicy.deleteMany({ where: { domain: PATTERN_DOMAIN } });
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanupTestData();
    await prisma.emailPolicy.deleteMany({ where: { domain: { in: ALL_DOMAINS } } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("provisionUserOnLogin", () => {
  it("nega e-mail de domínio pessoal", async () => {
    const result = await provisionUserOnLogin({
      email: "alguem@gmail.com",
      name: "Alguém",
      avatarUrl: null,
    });

    expect(result).toEqual({ ok: false, reason: "domain-not-allowed" });
  });

  it("nega formato de e-mail inválido", async () => {
    const result = await provisionUserOnLogin({
      email: "sem-arroba",
      name: null,
      avatarUrl: null,
    });

    expect(result).toEqual({ ok: false, reason: "invalid-shape" });
  });

  it("nega domínio sem política e fora da lista do ambiente", async () => {
    const result = await provisionUserOnLogin({
      email: "ninguem@dominio-nao-autorizado.local",
      name: null,
      avatarUrl: null,
    });

    expect(result).toEqual({ ok: false, reason: "domain-not-allowed" });
  });

  it("nega domínio cuja política está inativa", async () => {
    await configurePolicy(TEST_DOMAIN, { active: false });

    const result = await provisionUserOnLogin({
      email: `inativo-policy@${TEST_DOMAIN}`,
      name: null,
      avatarUrl: null,
    });

    expect(result).toEqual({ ok: false, reason: "domain-not-allowed" });
  });

  it("cria usuário PENDING quando a política não auto-aprova", async () => {
    const email = `novato@${TEST_DOMAIN}`;
    const result = await provisionUserOnLogin({ email, name: "Novato", avatarUrl: null });

    expect(result).toEqual({ ok: false, reason: "awaiting-approval" });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("PENDING");

    // Sem autoApprove não se cria vínculo: quem define é o administrador.
    const memberships = await prisma.membership.count({ where: { userId: user.id } });
    expect(memberships).toBe(0);
  });

  it("cria usuário ACTIVE com vínculo quando a política auto-aprova", async () => {
    await configurePolicy(TEST_DOMAIN, { autoApprove: true });

    const email = `auto@${TEST_DOMAIN}`;
    const result = await provisionUserOnLogin({ email, name: "Auto", avatarUrl: null });

    expect(result.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("ACTIVE");

    const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.branchId).toBe(matrixBranchId);
    expect(memberships[0]?.roleId).toBe(solicitanteRoleId);
  });

  it("aceita usuário ACTIVE existente e registra o último login", async () => {
    const email = `ativo@${TEST_DOMAIN}`;
    await prisma.user.create({ data: { email, name: "Ativo", status: "ACTIVE" } });

    const result = await provisionUserOnLogin({ email, name: "Ativo", avatarUrl: null });

    expect(result.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("nega usuário suspenso mesmo com domínio válido", async () => {
    const email = `suspenso@${TEST_DOMAIN}`;
    await prisma.user.create({ data: { email, name: "Suspenso", status: "SUSPENDED" } });

    const result = await provisionUserOnLogin({ email, name: null, avatarUrl: null });

    expect(result).toEqual({ ok: false, reason: "suspended" });
  });

  it("nega usuário inativo", async () => {
    const email = `inativo@${TEST_DOMAIN}`;
    await prisma.user.create({ data: { email, name: "Inativo", status: "INACTIVE" } });

    const result = await provisionUserOnLogin({ email, name: null, avatarUrl: null });

    expect(result).toEqual({ ok: false, reason: "user-inactive" });
  });

  it("nega usuário PENDING sem convite", async () => {
    await prisma.user.create({
      data: { email: ADMIN_EMAIL, name: "Aguardando", status: "PENDING" },
    });

    const result = await provisionUserOnLogin({ email: ADMIN_EMAIL, name: null, avatarUrl: null });

    expect(result).toEqual({ ok: false, reason: "pending-approval" });
  });

  it("ativa o usuário PENDING quando existe convite válido e cria o vínculo", async () => {
    const email = `convidado@${TEST_DOMAIN}`;
    await prisma.user.create({ data: { email, name: "Convidado", status: "PENDING" } });

    await prisma.invite.create({
      data: {
        email,
        token: `teste-${Date.now()}`,
        roleId: adminRoleId,
        branchId: matrixBranchId,
        invitedById: adminUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "PENDING",
      },
    });

    const result = await provisionUserOnLogin({ email, name: "Convidado", avatarUrl: null });

    expect(result.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("ACTIVE");

    const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.roleId).toBe(adminRoleId);

    const invite = await prisma.invite.findFirstOrThrow({ where: { email } });
    expect(invite.status).toBe("ACCEPTED");
    expect(invite.acceptedById).toBe(user.id);
  });

  it("ignora convite vencido, marca como EXPIRED e mantém o usuário pendente", async () => {
    const email = `vencido@${TEST_DOMAIN}`;
    await prisma.user.create({ data: { email, name: "Vencido", status: "PENDING" } });

    await prisma.invite.create({
      data: {
        email,
        token: `vencido-${Date.now()}`,
        roleId: adminRoleId,
        branchId: matrixBranchId,
        invitedById: adminUserId,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        status: "PENDING",
      },
    });

    const result = await provisionUserOnLogin({ email, name: null, avatarUrl: null });

    expect(result).toEqual({ ok: false, reason: "pending-approval" });

    const invite = await prisma.invite.findFirstOrThrow({ where: { email } });
    expect(invite.status).toBe("EXPIRED");
  });

  it("respeita o pattern da política quando ele existe", async () => {
    await configurePolicy(PATTERN_DOMAIN, {
      pattern: "^.+\\+filial[a-z]+@",
      autoApprove: true,
    });

    const denied = await provisionUserOnLogin({
      email: `joao@${PATTERN_DOMAIN}`,
      name: null,
      avatarUrl: null,
    });

    expect(denied).toEqual({ ok: false, reason: "pattern-mismatch" });

    const allowed = await provisionUserOnLogin({
      email: `joao+filialsp@${PATTERN_DOMAIN}`,
      name: null,
      avatarUrl: null,
    });

    expect(allowed.ok).toBe(true);
  });

  it("trata pattern inválida como negativa, nunca como liberação", async () => {
    await configurePolicy(PATTERN_DOMAIN, { pattern: "([a-z", autoApprove: true });

    const result = await provisionUserOnLogin({
      email: `joao@${PATTERN_DOMAIN}`,
      name: null,
      avatarUrl: null,
    });

    expect(result).toEqual({ ok: false, reason: "pattern-mismatch" });
  });
});
