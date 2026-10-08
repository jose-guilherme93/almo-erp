import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";

import { AssetActions } from "@/components/domain/asset-actions";
import { AssetStatusBadge, ASSET_STATUS_LABEL } from "@/components/domain/asset-status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { listBranchOptions } from "@/server/services/branch";
import { formatAssetTagLabel } from "@/server/services/patrimonio/tag";
import { getAsset, listAssignableUsers } from "@/server/services/patrimonio";

export const metadata: Metadata = {
  title: "Patrimônio",
};

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Bem criado na entrada",
  ASSIGNED: "Entregue a um responsável",
  RETURNED: "Devolvido ao almoxarifado",
  TRANSFERRED: "Transferido para outra unidade",
  MAINTENANCE_STARTED: "Enviado para manutenção",
  MAINTENANCE_DONE: "Retornou da manutenção",
  RETIRED: "Baixado",
};

type AssetPageProps = {
  params: Promise<{ id: string }>;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default async function PatrimonioDetalhePage({ params }: AssetPageProps) {
  const { id } = await params;
  const context = await requirePagePermission("patrimonio:read");

  let asset: Awaited<ReturnType<typeof getAsset>>;

  try {
    asset = await getAsset(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canManage = context.hasPermission("patrimonio:manage");
  const users =
    canManage && asset.status !== "RETIRED"
      ? await listAssignableUsers(context, asset.branch.id)
      : [];
  const branches = canManage
    ? (await listBranchOptions(context))
        .filter((branch) => branch.id !== asset.branch.id)
        .map((branch) => ({ id: branch.id, name: branch.name }))
    : [];

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={asset.item.name}
        description={`${formatAssetTagLabel(asset.tag)} · série ${asset.serialNumber ?? "—"}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/patrimonio">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <AssetStatusBadge status={asset.status} />
        {asset.custodian ? (
          <Badge variant="secondary">com {asset.custodian.name}</Badge>
        ) : (
          <Badge variant="outline">Almoxarifado</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ficha do bem</CardTitle>
          <CardDescription>
            Etiqueta gravada <span className="font-mono">{asset.tag}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row label="Material">
              <span className="font-medium">{asset.item.name}</span>{" "}
              <span className="text-muted-foreground font-mono text-xs">({asset.item.code})</span>
            </Row>
            <Row label="Unidade de medida">{asset.item.unit.code}</Row>
            <Row label="Responsável">
              {asset.custodian ? asset.custodian.name : "Almoxarifado (dono padrão)"}
            </Row>
            <Row label="Local">
              {asset.storageLocation ? asset.storageLocation.name : "Almoxarifado"}
            </Row>
            <Row label="Unidade">{asset.branch.name}</Row>
            <Row label="Estado">{ASSET_STATUS_LABEL[asset.status]}</Row>
            <Row label="Adquirido em">
              {asset.acquiredAt ? formatDateTime(asset.acquiredAt) : "—"}
            </Row>
            <Row label="Baixado em">{asset.retiredAt ? formatDateTime(asset.retiredAt) : "—"}</Row>
          </dl>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Movimentar</CardTitle>
            <CardDescription>
              A posse não é saída de estoque: o bem continua sendo da unidade.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssetActions
              assetId={asset.id}
              status={asset.status}
              users={users}
              branches={branches}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" aria-hidden />
            Histórico de rastreio
          </CardTitle>
          <CardDescription>Tudo o que já aconteceu com este bem, em ordem.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {asset.events.map((event) => (
              <li key={event.id} className="border-l-2 pl-3">
                <p className="text-sm font-medium">{EVENT_LABEL[event.type] ?? event.type}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(event.createdAt)}
                  {event.actor ? ` · por ${event.actor.name}` : ""}
                  {event.toCustodian ? ` · para ${event.toCustodian.name}` : ""}
                  {event.toBranch ? ` · para ${event.toBranch.name}` : ""}
                </p>
                {event.notes ? <p className="mt-1 text-sm">{event.notes}</p> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </PageBody>
  );
}
