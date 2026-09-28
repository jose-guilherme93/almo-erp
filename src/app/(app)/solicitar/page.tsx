import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Wrench } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Solicitar",
};

/**
 * Tela de escolha: o que você precisa?
 *
 * Uma decisão só, dois botões grandes. É a primeira tela do fluxo para quem
 * não é da administração, então nada de menu: material ou reparo, e segue.
 */
export default async function SolicitarPage() {
  const context = await requirePageSession();

  const canRequestMaterial = context.hasPermission("solicitacao:create");
  const canRequestRepair = context.hasPermission("manutencao:create");

  const options = [
    {
      href: "/solicitacoes/nova",
      title: "Preciso de material",
      description:
        "Pedir itens do almoxarifado: EPI, material de limpeza, escritório, copa. O responsável pela unidade aprova e o almoxarife entrega.",
      hint: "Ex.: 2 caixas de luva, 1 caixa de caneta azul",
      icon: ClipboardList,
      enabled: canRequestMaterial,
    },
    {
      href: "/reparos/novo",
      title: "Preciso de um reparo",
      description:
        "Abrir um chamado de manutenção: elétrica, hidráulica, ar-condicionado, mobiliário, equipamento. A manutenção da unidade assume e informa o andamento.",
      hint: "Ex.: ar-condicionado da sala 3 parou",
      icon: Wrench,
      enabled: canRequestRepair,
    },
  ].filter((option) => option.enabled);

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="O que você precisa?"
        description="Escolha uma opção. O pedido vai direto para quem responde pela unidade."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;

          return (
            <Link key={option.href} href={option.href} className="block">
              <Card className="hover:border-primary/40 h-full transition-colors">
                <CardHeader>
                  <span className="bg-accent text-accent-foreground mb-2 flex size-11 items-center justify-center rounded-lg">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle className="text-base">{option.title}</CardTitle>
                  <CardDescription className="text-balance">{option.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-xs italic">{option.hint}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {options.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Você ainda não pode abrir pedidos</CardTitle>
            <CardDescription>
              Seu acesso não inclui solicitar material nem abrir chamado. Fale com o administrador
              da sua unidade.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Você acompanha tudo em <span className="font-medium">Meu painel</span>: o que pediu, em que
        pé está e o histórico de entregas.
      </p>
    </PageBody>
  );
}
