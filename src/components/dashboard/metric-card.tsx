import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Cartão de indicador.
 *
 * O `href` transforma o card em atalho para a tela que explica o número: um
 * dashboard que não leva a lugar nenhum é só decoração.
 */
export function MetricCard({
  title,
  value,
  hint,
  href,
  tone = "neutral",
  icon,
}: {
  title: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: "neutral" | "warning" | "danger" | "success";
  icon?: ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "text-amber-600"
      : tone === "danger"
        ? "text-red-600"
        : tone === "success"
          ? "text-emerald-600"
          : "";

  const content = (
    <Card className={cn(href && "hover:border-primary/40 transition-colors")}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {title}
        </CardDescription>
        <CardTitle className={cn("text-2xl", toneClass)}>{value}</CardTitle>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardHeader>
    </Card>
  );

  if (!href) return content;

  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}

/** Cartão que envolve um gráfico, com estado vazio tratado. */
export function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Variação entre dois períodos. */
export function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;

  const change = ((current - previous) / previous) * 100;
  const up = change > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs",
        up ? "text-emerald-600" : "text-red-600",
      )}
    >
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(change).toFixed(0)}%
    </span>
  );
}
