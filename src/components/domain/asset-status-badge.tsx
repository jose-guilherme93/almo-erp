import { Badge } from "@/components/ui/badge";

/**
 * Estado do patrimônio na interface.
 *
 * Union local, como o resto dos `status-badge`: componente (inclusive cliente)
 * nunca importa o Prisma Client (AGENTS.md §11). Bate com o enum `AssetStatus`.
 */
export type AssetStatusKey = "IN_STOCK" | "IN_USE" | "IN_MAINTENANCE" | "RETIRED";

export const ASSET_STATUS_LABEL: Record<AssetStatusKey, string> = {
  IN_STOCK: "No almoxarifado",
  IN_USE: "Em posse de alguém",
  IN_MAINTENANCE: "Em manutenção",
  RETIRED: "Baixado",
};

const VARIANT: Record<AssetStatusKey, "default" | "secondary" | "destructive" | "outline"> = {
  IN_STOCK: "default",
  IN_USE: "secondary",
  IN_MAINTENANCE: "destructive",
  RETIRED: "outline",
};

export function AssetStatusBadge({ status }: { status: AssetStatusKey }) {
  return <Badge variant={VARIANT[status]}>{ASSET_STATUS_LABEL[status]}</Badge>;
}
