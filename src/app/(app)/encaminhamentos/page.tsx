import type { Metadata } from "next";
import Link from "next/link";

import { DELEGATION_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { firstParam, type RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listDelegations } from "@/server/services/delegation";

export const metadata: Metadata = {
  title: "Encaminhamentos",
};

/**
 * Caixa de entrada do setor: etapas que outros setores encaminharam.
 *
 * A TI vê aqui as perícias que o almoxarifado pediu; o almoxarifado vê o que a
 * TI devolveu. É a "fila do setor", separada da fila de aprovação.
 */
export default async function EncaminhamentosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("manutencao:atender");

  const forMySector = firstParam(params, "todos") !== "1";
  const status = firstParam(params, "situacao") ?? null;

  const result = await listDelegations(context, {
    forMySector,
    status,
  });

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Encaminhamentos"
        description={
          forMySector
            ? "Etapas que outros setores pediram ao seu setor."
            : "Todas as etapas que o seu escopo enxerga."
        }
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href={forMySector ? "/encaminhamentos?todos=1" : "/encaminhamentos"}
          className="border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
        >
          {forMySector ? "Ver todas do escopo" : "Ver só do meu setor"}
        </Link>

        <Link
          href="/encaminhamentos?situacao=PENDING"
          className="border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
        >
          Aguardando aceite
        </Link>
      </div>

      {result.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nada por aqui</CardTitle>
            <CardDescription>Nenhuma etapa encaminhada com os filtros atuais.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {result.items.map((item) => {
            const isRequest = Boolean(item.request);
            const entityNumber = item.request?.number ?? item.maintenanceRequest?.number ?? "—";

            return (
              <li key={item.id}>
                <Link href={`/encaminhamentos/${item.id}`} className="block">
                  <Card className="hover:border-primary/40 transition-colors">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {item.fromSector.name} → {item.toSector.name}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {isRequest ? "Solicitação" : "Chamado"} {entityNumber} ·{" "}
                          {item.request?.branch.code ?? ""}
                          {item.request?.branch.code ? " · " : ""}
                          {formatDateTime(item.createdAt)}
                        </p>
                        <p className="text-muted-foreground mt-1 truncate text-sm">{item.reason}</p>
                      </div>

                      {statusBadge(DELEGATION_STATUS, item.status)}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
