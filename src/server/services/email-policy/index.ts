import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { EmailPolicyInput } from "@/lib/validation/user";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";

/**
 * Serviço de políticas de e-mail.
 *
 * A política é a camada extensível da regra de acesso (docs/ARQUITETURA.md §4.2):
 * permite ligar um domínio, exigir um padrão de e-mail e auto-aprovar o
 * primeiro login, tudo sem deploy.
 */

export async function listEmailPolicies() {
  return prisma.emailPolicy.findMany({
    orderBy: { domain: "asc" },
    select: {
      id: true,
      domain: true,
      pattern: true,
      autoApprove: true,
      active: true,
      updatedAt: true,
      defaultRole: { select: { id: true, name: true } },
      defaultBranch: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function getEmailPolicy(policyId: string) {
  const policy = await prisma.emailPolicy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      domain: true,
      pattern: true,
      autoApprove: true,
      active: true,
      defaultRoleId: true,
      defaultBranchId: true,
      defaultRole: { select: { name: true } },
      defaultBranch: { select: { code: true, name: true } },
    },
  });

  if (!policy) {
    throw new NotFoundError("Política de e-mail");
  }

  return policy;
}

/** Quantos usuários e convites existem em um domínio (mostrado na tela). */
export async function countDomainUsage(domain: string) {
  const [users, invites] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: `@${domain}` } } }),
    prisma.invite.count({ where: { email: { endsWith: `@${domain}` } } }),
  ]);

  return { users, invites };
}

export async function listEmailPoliciesWithUsage() {
  const policies = await listEmailPolicies();

  return Promise.all(
    policies.map(async (policy) => ({
      ...policy,
      usage: await countDomainUsage(policy.domain),
    })),
  );
}

export async function createEmailPolicy(
  context: AuthContext,
  input: EmailPolicyInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.emailPolicy.findUnique({
    where: { domain: input.domain },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError("Já existe uma política para este domínio.");
  }

  return prisma.$transaction(async (tx) => {
    const policy = await tx.emailPolicy.create({
      data: {
        domain: input.domain,
        pattern: input.pattern && input.pattern.length > 0 ? input.pattern : null,
        autoApprove: input.autoApprove,
        defaultRoleId:
          input.defaultRoleId && input.defaultRoleId.length > 0 ? input.defaultRoleId : null,
        defaultBranchId:
          input.defaultBranchId && input.defaultBranchId.length > 0 ? input.defaultBranchId : null,
        active: input.active,
      },
      select: { id: true, domain: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "email_policy.created",
        entityType: "EmailPolicy",
        entityId: policy.id,
        after: { ...input },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return policy;
  });
}

export async function updateEmailPolicy(
  context: AuthContext,
  policyId: string,
  input: EmailPolicyInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getEmailPolicy(policyId);

  const conflicting = await prisma.emailPolicy.findFirst({
    where: { domain: input.domain, id: { not: policyId } },
    select: { id: true },
  });

  if (conflicting) {
    throw new ConflictError("Já existe uma política para este domínio.");
  }

  return prisma.$transaction(async (tx) => {
    const policy = await tx.emailPolicy.update({
      where: { id: policyId },
      data: {
        domain: input.domain,
        pattern: input.pattern && input.pattern.length > 0 ? input.pattern : null,
        autoApprove: input.autoApprove,
        defaultRoleId:
          input.defaultRoleId && input.defaultRoleId.length > 0 ? input.defaultRoleId : null,
        defaultBranchId:
          input.defaultBranchId && input.defaultBranchId.length > 0 ? input.defaultBranchId : null,
        active: input.active,
      },
      select: { id: true, domain: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "email_policy.updated",
        entityType: "EmailPolicy",
        entityId: policyId,
        before: {
          domain: current.domain,
          pattern: current.pattern,
          autoApprove: current.autoApprove,
          active: current.active,
        },
        after: { ...input },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return policy;
  });
}

export async function toggleEmailPolicy(
  context: AuthContext,
  policyId: string,
  active: boolean,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getEmailPolicy(policyId);

  return prisma.$transaction(async (tx) => {
    const policy = await tx.emailPolicy.update({
      where: { id: policyId },
      data: { active },
      select: { id: true, active: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "email_policy.toggled",
        entityType: "EmailPolicy",
        entityId: policyId,
        before: { active: current.active },
        after: { active },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return policy;
  });
}
