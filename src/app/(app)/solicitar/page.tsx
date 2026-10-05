import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, MonitorSmartphone, Wrench } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Solicitar",
};

/**
 * Tela de escolha: o que você precisa?
 *
 * Mobile primeiro: três botões grandes e quase nada de texto — o próprio título
 * já diz para que serve. É a primeira tela de quem só faz pedidos.
 */
export default async function SolicitarPage() {
  const context = await requirePageSession();

  const canRequestMaterial = context.hasPermission("solicitacao:create");
  const canRequestRepair = context.hasPermission("manutencao:create");

  const options = [
    {
      href: "/solicitacoes/nova",
      title: "Pedir material",
      icon: ClipboardList,
      enabled: canRequestMaterial,
    },
    {
      href: "/reparos/novo",
      title: "Pedir reparo",
      icon: Wrench,
      enabled: canRequestRepair,
    },
    {
      href: "/reparos/novo?categoria=IT",
      title: "Chamado de TI",
      icon: MonitorSmartphone,
      enabled: canRequestRepair,
    },
  ].filter((option) => option.enabled);

  return (
    <PageBody className="max-w-xl">
      <PageHeader title="O que você precisa?" />

      <div className="grid gap-3">
        {options.map((option) => {
          const Icon = option.icon;

          return (
            <Link key={option.href} href={option.href} className="block">
              <Card className="hover:border-primary/50 active:bg-accent/40 transition-colors">
                <CardContent className="flex items-center gap-4 py-5">
                  <span className="bg-accent text-accent-foreground flex size-12 shrink-0 items-center justify-center rounded-xl">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <CardTitle className="text-lg">{option.title}</CardTitle>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {options.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            Seu acesso ainda não permite abrir pedidos. Fale com o administrador da sua unidade.
          </CardContent>
        </Card>
      ) : null}
    </PageBody>
  );
}
