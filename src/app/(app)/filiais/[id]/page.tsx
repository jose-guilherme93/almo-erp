import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { BranchForm, type BranchOption } from "@/components/domain/branch-form";
import { BranchStatusActions } from "@/components/domain/branch-status-actions";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { StorageLocationManager } from "@/components/domain/storage-location-manager";
import { statusBadge, USER_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCnpj, formatDateTime, formatPhone, formatZipCode } from "@/lib/format";
import { firstParam, type RawSearchParams } from "@/lib/pagination";
import { isAppError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listAuditTrail } from "@/server/services/audit";
import { getBranchDetail, listBranchOptions } from "@/server/services/branch";

export const metadata: Metadata = {
  title: "Unidade",
};

const TABS = [
  { id: "dados", label: "Dados" },
  { id: "locais", label: "Locais de estoque" },
  { id: "usuarios", label: "Usuários" },
  { id: "historico", label: "Histórico" },
] as const;

type FilialPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function FilialDetalhePage({ params, searchParams }: FilialPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("filial:read", undefined);

  if (!context.branchIds.includes(id)) {
    notFound();
  }

  let branch: Awaited<ReturnType<typeof getBranchDetail>>;

  try {
    branch = await getBranchDetail(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const activeTab = (firstParam(query, "aba") ?? "dados") as (typeof TABS)[number]["id"];
  const tab = TABS.some((entry) => entry.id === activeTab) ? activeTab : "dados";

  const canManage = context.hasPermission("filial:manage", branch.id);
  const canManageLocations = context.hasPermission("local:manage", branch.id);

  const [people, audit, branchOptions] = await Promise.all([
    canManage
      ? prisma.user.findMany({
          where: { status: "ACTIVE", active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    tab === "historico"
      ? listAuditTrail({ entityType: "Branch", entityId: id, limit: 50 })
      : Promise.resolve([]),
    canManage ? listBranchOptions(context) : Promise.resolve([]),
  ]);

  // Unidade superior: as opções visíveis, mais o pai atual caso esteja inativo,
  // excluindo a própria unidade (o servidor também recusaria o auto-vínculo).
  const parentOptions: BranchOption[] = branchOptions.map(({ id: optionId, code, name }) => ({
    id: optionId,
    code,
    name,
  }));

  const currentParent = branch.parent;

  if (currentParent && !parentOptions.some((option) => option.id === currentParent.id)) {
    parentOptions.push({
      id: currentParent.id,
      code: currentParent.code,
      name: currentParent.name,
    });
  }

  const selectableParents = parentOptions.filter((option) => option.id !== branch.id);

  const successMessage = successMessageFrom(query, {
    criada: "Unidade cadastrada.",
    salva: "Dados da unidade atualizados.",
  });

  const address = [
    branch.street,
    branch.number,
    branch.complement,
    branch.district,
    branch.city && branch.state ? `${branch.city}/${branch.state}` : (branch.city ?? branch.state),
    branch.zipCode ? `CEP ${formatZipCode(branch.zipCode)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={branch.name}
        description={`${branch.code}${branch.city ? ` · ${branch.city}/${branch.state ?? ""}` : ""}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/filiais">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={branch.type === "MATRIX" ? "default" : "secondary"}>
          {branch.type === "MATRIX" ? "Matriz" : "Unidade"}
        </Badge>
        <Badge variant={branch.active ? "secondary" : "outline"}>
          {branch.active ? "Ativa" : "Inativa"}
        </Badge>
        {branch.cnpj ? (
          <span className="text-muted-foreground text-sm">{formatCnpj(branch.cnpj)}</span>
        ) : null}
      </div>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Seções da unidade">
        {TABS.map((entry) => (
          <Link
            key={entry.id}
            href={`/filiais/${branch.id}?aba=${entry.id}`}
            aria-current={tab === entry.id ? "page" : undefined}
            className={
              tab === entry.id
                ? "border-primary text-foreground -mb-px border-b-2 px-3 py-2 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
            }
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "dados" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Cadastro</CardTitle>
              <CardDescription>
                {canManage
                  ? "Alterações ficam registradas na auditoria."
                  : "Somente a matriz pode alterar o cadastro de unidades."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <BranchForm
                  mode="edit"
                  people={people}
                  branches={selectableParents}
                  defaultValues={{
                    id: branch.id,
                    code: branch.code,
                    name: branch.name,
                    type: branch.type,
                    legalName: branch.legalName,
                    tradeName: branch.tradeName,
                    cnpj: branch.cnpj,
                    stateRegistration: branch.stateRegistration,
                    cnae: branch.cnae,
                    zipCode: branch.zipCode,
                    street: branch.street,
                    number: branch.number,
                    complement: branch.complement,
                    district: branch.district,
                    city: branch.city,
                    state: branch.state,
                    country: branch.country,
                    email: branch.email,
                    phone: branch.phone,
                    whatsapp: branch.whatsapp,
                    legalResponsibleId: branch.legalResponsibleId,
                    legalResponsibleName: branch.legalResponsibleName,
                    legalResponsibleDocument: branch.legalResponsibleDocument,
                    warehouseResponsibleId: branch.warehouseResponsibleId,
                    notificationResponsibleId: branch.notificationResponsibleId,
                    defaultApproverId: branch.defaultApproverId,
                    notes: branch.notes,
                    parentId: branch.parentId,
                    active: branch.active,
                  }}
                />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <DetailItem label="Endereço" value={address || "—"} />
                  <DetailItem label="E-mail" value={branch.email ?? "—"} />
                  <DetailItem
                    label="Telefone"
                    value={branch.phone ? formatPhone(branch.phone) : "—"}
                  />
                  <DetailItem
                    label="WhatsApp"
                    value={branch.whatsapp ? formatPhone(branch.whatsapp) : "—"}
                  />
                  <DetailItem
                    label="Responsável legal"
                    value={branch.legalResponsible?.name ?? branch.legalResponsibleName ?? "—"}
                  />
                  <DetailItem
                    label="Responsável pelo almoxarifado"
                    value={branch.warehouseResponsible?.name ?? "—"}
                  />
                  <DetailItem
                    label="Aprovador padrão"
                    value={branch.defaultApprover?.name ?? "—"}
                  />
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Situação da unidade</CardTitle>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <BranchStatusActions
                  branchId={branch.id}
                  active={branch.active}
                  isMatrix={branch.type === "MATRIX"}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Somente a matriz pode ativar ou desativar unidades.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "locais" ? (
        <Card>
          <CardHeader>
            <CardTitle>Locais de estoque</CardTitle>
            <CardDescription>
              Onde o material fica guardado. Todo saldo de estoque pertence a um local.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StorageLocationManager
              branchId={branch.id}
              canManage={canManageLocations}
              people={people.map((person) => ({ id: person.id, name: person.name }))}
              locations={branch.storageLocations.map((location) => ({
                id: location.id,
                code: location.code,
                name: location.name,
                type: location.type,
                description: location.description,
                active: location.active,
                responsibleId: location.responsible?.id ?? null,
                responsibleName: location.responsible?.name ?? null,
                stockLevelCount: location._count.stockLevels,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === "usuarios" ? (
        <Card>
          <CardHeader>
            <CardTitle>Usuários da unidade</CardTitle>
            <CardDescription>
              Gerencie vínculos em <span className="font-medium">Administração → Usuários</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {branch.memberships.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhum usuário vinculado a esta unidade.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {branch.memberships.map((membership) => (
                  <li
                    key={membership.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{membership.user.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {membership.user.email}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {statusBadge(USER_STATUS, membership.user.status)}
                      <span className="text-muted-foreground text-xs">{membership.role.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "historico" ? (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de alterações</CardTitle>
            <CardDescription>Toda mudança no cadastro fica registrada.</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhuma alteração registrada.</p>
            ) : (
              <ul className="divide-y text-sm">
                {audit.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-medium">{entry.action}</span>
                      {entry.actor ? (
                        <span className="text-muted-foreground"> por {entry.actor.name}</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </PageBody>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
