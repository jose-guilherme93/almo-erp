import { DelegationActions } from "@/components/domain/delegation-actions";
import { DELEGATION_STATUS, statusBadge } from "@/components/domain/status-badge";
import { formatDateTime } from "@/lib/format";

export type DelegationListItem = {
  id: string;
  status: string;
  reason: string;
  report: string | null;
  createdAt: Date;
  completedAt: Date | null;
  returnedAt: Date | null;
  fromSector: { id: string; name: string };
  toSector: { id: string; name: string };
  requestedBy: { name: string };
  completedBy: { name: string } | null;
};

const OPEN_STATUSES = ["PENDING", "ACCEPTED", "IN_PROGRESS"];

/**
 * Lista as etapas encaminhadas de uma demanda, com o que cada setor ainda pode
 * fazer. Enquanto a etapa está aberta, quem responde é o setor de destino.
 */
export function DelegationList({
  items,
  sectorIds,
}: {
  items: DelegationListItem[];
  sectorIds: readonly string[];
}) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhuma etapa foi encaminhada para outro setor.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const isTargetSector = sectorIds.includes(item.toSector.id);
        const isOriginSector = sectorIds.includes(item.fromSector.id);
        const isOpen = OPEN_STATUSES.includes(item.status);

        return (
          <li key={`${item.id}-${item.status}`} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {item.fromSector.name} → {item.toSector.name}
              </p>
              {statusBadge(DELEGATION_STATUS, item.status)}
            </div>

            <p className="text-sm">
              <span className="text-muted-foreground">Pedido: </span>
              {item.reason}
            </p>

            {item.report ? (
              <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                <span className="font-medium">Laudo: </span>
                {item.report}
                {item.completedBy ? (
                  <span className="block text-xs opacity-80">por {item.completedBy.name}</span>
                ) : null}
              </p>
            ) : null}

            <p className="text-muted-foreground text-xs">
              Enviado por {item.requestedBy.name} em {formatDateTime(item.createdAt)}
              {item.completedAt ? ` · concluído em ${formatDateTime(item.completedAt)}` : ""}
              {item.returnedAt ? ` · devolvido em ${formatDateTime(item.returnedAt)}` : ""}
            </p>

            <DelegationActions
              delegationId={item.id}
              status={item.status}
              isTargetSector={isTargetSector}
              isOriginSector={isOriginSector}
              canCancel={isOriginSector && isOpen}
            />
          </li>
        );
      })}
    </ul>
  );
}
