"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { formatQuantity } from "@/lib/format";
import { aplicarAjusteInventarioAction } from "@/server/actions/inventario";

export type DivergentLine = {
  id: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  locationName: string;
  systemQuantity: string;
  countedQuantity: string;
};

/**
 * Revisão e ajuste das divergências.
 *
 * Cada divergência exige justificativa: o ajuste é a única explicação de por
 * que o saldo mudou sem documento de origem, e é o que separa uma correção
 * legítima de um erro de lançamento.
 */
export function InventoryAdjustmentForm({
  sessionId,
  lines,
}: {
  sessionId: string;
  lines: DivergentLine[];
}) {
  const [justifications, setJustifications] = useState<Record<string, string>>({});

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    aplicarAjusteInventarioAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const totalDifference = lines.reduce(
    (total, line) => total + (Number(line.countedQuantity) - Number(line.systemQuantity)),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Divergências encontradas</CardTitle>
        <CardDescription>
          {lines.length} item(ns) com contagem diferente do sistema. A diferença total é{" "}
          {totalDifference > 0 ? "+" : ""}
          {formatQuantity(totalDifference)}.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {state && !state.ok ? <FormError message={state.error} /> : null}

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />

          <ul className="divide-y rounded-md border">
            {lines.map((line) => {
              const difference = Number(line.countedQuantity) - Number(line.systemQuantity);

              return (
                <li key={line.id} className="space-y-2 p-3">
                  <input type="hidden" name="lineId" value={line.id} />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{line.itemName}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {line.itemCode} · {line.locationName}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        sistema {formatQuantity(line.systemQuantity)} → contado{" "}
                        {formatQuantity(line.countedQuantity)} {line.unitCode}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          difference > 0
                            ? "border-emerald-300 text-emerald-700"
                            : "border-red-300 text-red-700"
                        }
                      >
                        {difference > 0 ? "+" : ""}
                        {formatQuantity(difference)}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor={`justify-${line.id}`} className="text-xs">
                      Justificativa da divergência
                    </label>
                    <Input
                      id={`justify-${line.id}`}
                      name="justification"
                      value={justifications[line.id] ?? ""}
                      onChange={(event) =>
                        setJustifications((current) => ({
                          ...current,
                          [line.id]: event.target.value,
                        }))
                      }
                      placeholder="Ex.: material encontrado atrás de outra pilha na contagem"
                      required
                    />
                    {fieldErrors[`justifications.${lines.indexOf(line)}.justification`] ? (
                      <p role="alert" className="text-destructive text-xs">
                        {fieldErrors[`justifications.${lines.indexOf(line)}.justification`]?.join(
                          " ",
                        )}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-muted-foreground text-xs">
            Ao confirmar, um documento de movimentação é lançado para cada local com divergência e o
            saldo passa a refletir a contagem.
          </p>

          <Button type="submit" disabled={isPending}>
            {isPending ? "Ajustando…" : "Aplicar ajuste no estoque"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
