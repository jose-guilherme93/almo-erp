/**
 * Provisionamento de usuário no login (docs/ARQUITETURA.md §4).
 *
 * Decide se um e-mail autenticado pelo Google pode entrar e, quando pode,
 * garante que exista `User` + `Membership` correspondentes.
 *
 * Esta é a camada 2 da regra: a camada 1 (domínio/padrão de e-mail) está em
 * `@/lib/email-policy`.
 */
import {
  evaluateCorporateEmail,
  type AccessDenyReason,
  type EmailPolicyRule,
} from "@/lib/email-policy";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";

const log = logger.with({ service: "auth.provisioning" });

export type ProvisionResult =
  { ok: true; userId: string; created: boolean } | { ok: false; reason: AccessDenyReason };

async function loadActivePolicies(): Promise<EmailPolicyRule[]> {
  const policies = await prisma.emailPolicy.findMany({
    where: { active: true },
    select: { domain: true, pattern: true, autoApprove: true, active: true },
  });

  return policies;
}

/**
 * Aplica um convite pendente ao usuário recém-logado.
 * Devolve `true` se havia convite e ele foi aceito.
 */
async function consumePendingInvite(email: string, userId: string): Promise<boolean> {
  const invite = await prisma.invite.findFirst({
    where: { email, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!invite) return false;

  await prisma.$transaction(async (tx) => {
    await tx.invite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: userId },
    });

    await tx.membership.upsert({
      where: {
        userId_branchId_roleId: {
          userId,
          branchId: invite.branchId,
          roleId: invite.roleId,
        },
      },
      update: { active: true },
      create: {
        userId,
        branchId: invite.branchId,
        roleId: invite.roleId,
        active: true,
      },
    });
  });

  log.info("convite aceito no login", { email, inviteId: invite.id });

  return true;
}

/** Marca convites vencidos que ainda estão pendentes. */
async function expireStaleInvites(email: string): Promise<void> {
  await prisma.invite.updateMany({
    where: { email, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}

/**
 * Cria usuário + vínculo padrão a partir da política de e-mail que autorizou.
 */
async function createUserFromPolicy(
  email: string,
  name: string,
  avatarUrl: string | null,
  policy: EmailPolicyRule | null,
): Promise<string> {
  const autoApprove = policy?.autoApprove === true;

  const policyRecord = policy
    ? await prisma.emailPolicy.findUnique({
        where: { domain: policy.domain },
        select: { defaultRoleId: true, defaultBranchId: true },
      })
    : null;

  const matrix = await prisma.branch.findFirst({
    where: { type: "MATRIX", active: true },
    select: { id: true },
  });

  const branchId = policyRecord?.defaultBranchId ?? matrix?.id ?? null;

  const roleId =
    policyRecord?.defaultRoleId ??
    (
      await prisma.role.findUnique({
        where: { slug: "SOLICITANTE" },
        select: { id: true },
      })
    )?.id ??
    null;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      avatarUrl,
      status: autoApprove ? "ACTIVE" : "PENDING",
      ...(autoApprove ? { approvedAt: new Date() } : {}),
    },
  });

  // Só cria vínculo automaticamente quando o acesso é auto-aprovado e há
  // filial definida. Caso contrário, o administrador define o vínculo.
  if (autoApprove && branchId && roleId) {
    await prisma.membership.create({
      data: { userId: user.id, branchId, roleId, isDefault: true, active: true },
    });
  }

  log.info("usuário provisionado no primeiro login", {
    email,
    userId: user.id,
    autoApprove,
  });

  return user.id;
}

export async function provisionUserOnLogin(input: {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}): Promise<ProvisionResult> {
  const env = getEnv();
  const email = input.email.trim().toLowerCase();

  const policies = await loadActivePolicies();
  const evaluation = evaluateCorporateEmail(email, env.AUTH_ALLOWED_DOMAINS, policies);

  if (!evaluation.allowed) {
    log.warn("login negado pela regra de e-mail", { email, reason: evaluation.reason });
    return { ok: false, reason: evaluation.reason };
  }

  await expireStaleInvites(email);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    // Convite pendente vence a política: o administrador já decidiu o vínculo.
    const invite = await prisma.invite.findFirst({
      where: { email, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true },
    });

    if (invite) {
      const created = await prisma.user.create({
        data: {
          email,
          name: input.name ?? email,
          avatarUrl: input.avatarUrl,
          status: "ACTIVE",
          approvedAt: new Date(),
        },
      });

      await consumePendingInvite(email, created.id);

      return { ok: true, userId: created.id, created: true };
    }

    const userId = await createUserFromPolicy(
      email,
      input.name ?? email,
      input.avatarUrl,
      evaluation.matchedPolicy,
    );

    if (evaluation.matchedPolicy?.autoApprove) {
      return { ok: true, userId, created: true };
    }

    return { ok: false, reason: "awaiting-approval" };
  }

  switch (existing.status) {
    case "SUSPENDED":
      log.warn("login negado: usuário suspenso", { email });
      return { ok: false, reason: "suspended" };

    case "INACTIVE":
      log.warn("login negado: usuário inativo", { email });
      return { ok: false, reason: "user-inactive" };

    case "PENDING": {
      // Um convite aceito promove o usuário pendente a ativo.
      const accepted = await consumePendingInvite(email, existing.id);

      if (!accepted) {
        log.info("login negado: aguardando aprovação", { email });
        return { ok: false, reason: "pending-approval" };
      }

      await prisma.user.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", approvedAt: new Date() },
      });

      return { ok: true, userId: existing.id, created: false };
    }

    case "ACTIVE":
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          lastLoginAt: new Date(),
          name: input.name ?? existing.name,
          avatarUrl: input.avatarUrl ?? existing.avatarUrl,
        },
      });

      return { ok: true, userId: existing.id, created: false };
  }
}

/**
 * Confirmação do login local (e-mail + senha).
 *
 * O provider já validou a senha no `authorize()`. Aqui só reafirmamos o estado
 * da conta e registramos o acesso. **Não** passa pela regra de domínio de
 * e-mail: quem entra por senha é conta criada por administrador, de qualquer
 * domínio (é assim que o acesso sem Google funciona).
 */
export async function resolveLocalLogin(email: string): Promise<ProvisionResult> {
  const normalized = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, status: true, active: true, passwordHash: true },
  });

  if (!user || !user.passwordHash || !user.active) {
    return { ok: false, reason: "access-denied" };
  }

  if (user.status === "SUSPENDED") return { ok: false, reason: "suspended" };
  if (user.status === "INACTIVE") return { ok: false, reason: "user-inactive" };
  if (user.status === "PENDING") return { ok: false, reason: "pending-approval" };

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { ok: true, userId: user.id, created: false };
}
