import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { RoleForm } from "@/components/domain/role-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Novo perfil",
};

export default async function NovoPapelPage() {
  await requirePagePermission("papel:manage");

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Novo perfil"
        description="Crie um perfil sob medida selecionando as permissões necessárias."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/papeis">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent>
          <RoleForm mode="create" />
        </CardContent>
      </Card>
    </PageBody>
  );
}
