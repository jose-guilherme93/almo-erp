import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { CategoryInput } from "@/lib/validation/catalog";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";

/** Serviço de categorias de material (hierárquicas). */

/** Código da categoria que agrupa material sem classificação específica. */
export const GENERAL_CATEGORY_CODE = "GERAL";

/** Só a parte do cliente que a função precisa — serve para `prisma` e para `tx`. */
type CategoryClient = Pick<PrismaTypes.TransactionClient, "category">;

/**
 * Garante que a categoria "Geral" exista.
 *
 * `Item.categoryId` é obrigatório no banco, mas o usuário não deve escolher
 * categoria ao cadastrar material — ela é organização, não requisito. O caminho
 * principal (criar material pela leitura do código de barras) cai aqui.
 */
export async function ensureGeneralCategory(client: CategoryClient = prisma) {
  return client.category.upsert({
    where: { code: GENERAL_CATEGORY_CODE },
    update: {},
    create: {
      code: GENERAL_CATEGORY_CODE,
      name: "Geral",
      description: "Material sem classificação específica.",
    },
    select: { id: true, code: true, name: true, requiresApproval: true },
  });
}

export async function listCategories() {
  const categories = await prisma.category.findMany({
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      parentId: true,
      requiresApproval: true,
      active: true,
      _count: { select: { items: true, children: true } },
    },
  });

  return categories;
}

/** Categorias em árvore, para exibição e para os selects de pai. */
export type CategoryTreeNode = Awaited<ReturnType<typeof listCategories>>[number] & {
  children: CategoryTreeNode[];
  depth: number;
};

export async function listCategoryTree(): Promise<CategoryTreeNode[]> {
  const categories = await listCategories();
  const byId = new Map<string, CategoryTreeNode>();

  for (const category of categories) {
    byId.set(category.id, { ...category, children: [], depth: 0 });
  }

  const roots: CategoryTreeNode[] = [];

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Segunda passagem: propaga a profundidade para netos.
  const propagate = (nodes: CategoryTreeNode[], depth: number) => {
    for (const node of nodes) {
      node.depth = depth;
      propagate(node.children, depth + 1);
    }
  };

  propagate(roots, 0);

  return roots;
}

/** Categorias achatadas com indentação, para `<select>`. */
export async function listCategoryOptions(
  excludeId?: string,
): Promise<
  Array<{ id: string; code: string; name: string; label: string; requiresApproval: boolean }>
> {
  const tree = await listCategoryTree();
  const options: Array<{
    id: string;
    code: string;
    name: string;
    label: string;
    requiresApproval: boolean;
  }> = [];

  const walk = (nodes: CategoryTreeNode[]) => {
    for (const node of nodes) {
      if (node.id !== excludeId) {
        options.push({
          id: node.id,
          code: node.code,
          name: node.name,
          label: `${"— ".repeat(node.depth)}${node.name}`,
          requiresApproval: node.requiresApproval,
        });
      }
      walk(node.children);
    }
  };

  walk(tree);

  return options;
}

export async function createCategory(
  context: AuthContext,
  input: CategoryInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const taken = await prisma.category.findUnique({
    where: { code: input.code },
    select: { id: true },
  });

  if (taken) throw new ConflictError(`Já existe uma categoria com o código ${input.code}.`);

  if (input.parentId) {
    const parent = await prisma.category.findUnique({
      where: { id: input.parentId },
      select: { id: true, requiresApproval: true },
    });

    if (!parent) throw new NotFoundError("Categoria superior");
  }

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        parentId: input.parentId,
        requiresApproval: input.requiresApproval,
        active: input.active,
      },
      select: { id: true, code: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "category.created",
        entityType: "Category",
        entityId: category.id,
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return category;
  });
}

/** Rejeita hierarquia cíclica (A → B → A). */
async function assertNoCategoryCycle(
  categoryId: string,
  parentId: string | undefined,
): Promise<void> {
  if (!parentId) return;

  let cursor: string | undefined = parentId;

  for (let depth = 0; depth < 50 && cursor; depth += 1) {
    if (cursor === categoryId) {
      throw new BusinessRuleError(
        "Esta hierarquia criaria um ciclo: a categoria ficaria dentro dela mesma.",
      );
    }

    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });

    cursor = parent?.parentId ?? undefined;
  }
}

export async function updateCategory(
  context: AuthContext,
  input: CategoryInput & { categoryId: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, code: true, name: true, requiresApproval: true, active: true },
  });

  if (!current) throw new NotFoundError("Categoria");

  if (input.code !== current.code) {
    const taken = await prisma.category.findUnique({
      where: { code: input.code },
      select: { id: true },
    });

    if (taken && taken.id !== input.categoryId) {
      throw new ConflictError(`Já existe uma categoria com o código ${input.code}.`);
    }
  }

  if (input.parentId === input.categoryId) {
    throw new BusinessRuleError("A categoria não pode ser superior dela mesma.");
  }

  await assertNoCategoryCycle(input.categoryId, input.parentId);

  return prisma.$transaction(async (tx) => {
    await tx.category.update({
      where: { id: input.categoryId },
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        parentId: input.parentId,
        requiresApproval: input.requiresApproval,
        active: input.active,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "category.updated",
        entityType: "Category",
        entityId: input.categoryId,
        before: {
          code: current.code,
          name: current.name,
          requiresApproval: current.requiresApproval,
          active: current.active,
        },
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

export async function deactivateCategory(
  context: AuthContext,
  categoryId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      _count: { select: { items: true, children: true } },
    },
  });

  if (!category) throw new NotFoundError("Categoria");

  if (category._count.items > 0) {
    throw new BusinessRuleError(
      `Esta categoria tem ${category._count.items} material(is). Mova os materiais antes de desativar.`,
    );
  }

  if (category._count.children > 0) {
    throw new BusinessRuleError(
      `Esta categoria tem ${category._count.children} subcategoria(s). Desative as subcategorias antes.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.category.update({ where: { id: categoryId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "category.deactivated",
        entityType: "Category",
        entityId: categoryId,
        after: { active: false },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}
