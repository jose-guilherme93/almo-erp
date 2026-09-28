import type { Metadata } from "next";

import { CategoryManager, type CategoryNode } from "@/components/domain/category-manager";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listCategoryOptions, listCategoryTree } from "@/server/services/catalog/category";

export const metadata: Metadata = {
  title: "Categorias",
};

/** Achata a árvore em uma lista ordenada por profundidade, como a tela exibe. */
function flatten(nodes: Awaited<ReturnType<typeof listCategoryTree>>): CategoryNode[] {
  const result: CategoryNode[] = [];

  const walk = (list: typeof nodes) => {
    for (const node of list) {
      result.push({
        id: node.id,
        code: node.code,
        name: node.name,
        description: node.description,
        parentId: node.parentId,
        requiresApproval: node.requiresApproval,
        active: node.active,
        itemCount: node._count.items,
        depth: node.depth,
      });
      walk(node.children);
    }
  };

  walk(nodes);

  return result;
}

export default async function CategoriasPage() {
  const context = await requirePagePermission("categoria:read");

  const [tree, options] = await Promise.all([listCategoryTree(), listCategoryOptions()]);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Categorias"
        description="Organiza os materiais e define se a categoria exige aprovação para saída."
      />

      <Card>
        <CardHeader>
          <CardTitle>Categorias cadastradas</CardTitle>
          <CardDescription>
            Categorias são hierárquicas: uma raiz pode agrupar subcategorias. A marcação de
            aprovação é herdada pelos materiais criados dentro dela.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryManager
            canManage={context.hasPermission("categoria:manage")}
            categories={flatten(tree)}
            parentOptions={options.map((option) => ({ id: option.id, label: option.label }))}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
