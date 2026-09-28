"use client";

import { Search } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  cancelarInventarioAction,
  fecharContagemAction,
  salvarContagemAction,
} from "@/server/actions/inventario";

export type CountingLine = {
  id: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  barcode: string | null;
  locationName: string;
  systemQuantity: string;
  countedQuantity: string | null;
};

/**
 * Tela de contagem.
 *
 * Feita para tablet no balcão: campo grande, busca, filtro "só não contados" e
 * a opção de **ocultar o saldo do sistema** — contar às cegas evita que o
 * contador simplesmente confirme o número da tela.
 */
export function InventoryCountForm({
  sessionId,
  lines,
}: {
  sessionId: string;
  lines: CountingLine[];
}) {
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.countedQuantity ?? ""])),
  );
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [hideSystem, setHideSystem] = useState(false);

  const [saveState, saveAction, isSaving] = useActionState<
    ActionResult<{ saved: number }> | null,
    FormData
  >(salvarContagemAction, null);

  const [closeState, closeAction, isClosing] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(fecharContagemAction, null);

  useEffect(() => {
    for (const state of [saveState, closeState]) {
      if (!state) return;
      if (state.ok) toast.success(state.message ?? "Inventário atualizado.");
      else toast.error(state.error);
    }
  }, [saveState, closeState]);

  const normalizedSearch = search.trim().toLowerCase();

  const visible = lines.filter((line) => {
    if (onlyPending && counts[line.id] !== undefined && counts[line.id] !== "") return false;

    if (normalizedSearch.length === 0) return true;

    return (
      line.itemName.toLowerCase().includes(normalizedSearch) ||
      line.itemCode.toLowerCase().includes(normalizedSearch) ||
      (line.barcode ?? "").includes(normalizedSearch)
    );
  });

  const counted = lines.filter((line) => (counts[line.id] ?? "") !== "").length;
  const divergent = lines.filter((line) => {
    const value = counts[line.id];

    return value !== undefined && value !== "" && Number(value) !== Number(line.systemQuantity);
  }).length;

  const error =
    (saveState && !saveState.ok ? saveState.error : null) ??
    (closeState && !closeState.ok ? closeState.error : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Progresso</CardTitle>
          <CardDescription>
            {counted} de {lines.length} contados
            {divergent > 0 ? ` · ${divergent} com divergência` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="bg-muted h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={counted}
            aria-valuemin={0}
            aria-valuemax={lines.length}
            aria-label="Progresso da contagem"
          >
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${lines.length > 0 ? (counted / lines.length) * 100 : 0}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {error ? <FormError message={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, código ou código de barras…"
            aria-label="Buscar item na contagem"
            className="pl-8"
          />
        </div>

        <Button
          type="button"
          variant={onlyPending ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyPending((current) => !current)}
          aria-pressed={onlyPending}
        >
          Só não contados
        </Button>

        <Button
          type="button"
          variant={hideSystem ? "default" : "outline"}
          size="sm"
          onClick={() => setHideSystem((current) => !current)}
          aria-pressed={hideSystem}
        >
          {hideSystem ? "Mostrar sistema" : "Ocultar sistema"}
        </Button>
      </div>

      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="sessionId" value={sessionId} />

        <ul className="divide-y rounded-md border">
          {visible.length === 0 ? (
            <li className="text-muted-foreground p-4 text-sm">
              Nenhum item corresponde ao filtro.
            </li>
          ) : (
            visible.map((line) => {
              const value = counts[line.id] ?? "";
              const diverges = value !== "" && Number(value) !== Number(line.systemQuantity);

              return (
                <li key={line.id} className="flex flex-wrap items-center gap-3 p-3">
                  <input type="hidden" name="lineId" value={line.id} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{line.itemName}</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {line.itemCode} · {line.unitCode} · {line.locationName}
                    </p>
                  </div>

                  {!hideSystem ? (
                    <span className="text-muted-foreground text-sm">
                      sistema: {formatQuantity(line.systemQuantity)}
                    </span>
                  ) : null}

                  {diverges ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      divergência
                    </Badge>
                  ) : null}

                  <div className="w-32">
                    <label htmlFor={`count-${line.id}`} className="sr-only">
                      Quantidade contada de {line.itemName}
                    </label>
                    <Input
                      id={`count-${line.id}`}
                      name="countedQuantity"
                      type="number"
                      step="0.0001"
                      min="0"
                      inputMode="decimal"
                      placeholder="não contado"
                      value={value}
                      onChange={(event) =>
                        setCounts((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                      className={cn("text-right", diverges && "border-amber-400")}
                    />
                  </div>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Salvando…" : "Salvar contagem"}
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Encerrar a contagem</CardTitle>
          <CardDescription>
            Ao encerrar, as divergências são apuradas para revisão. O estoque ainda **não** é
            ajustado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={closeAction} className="space-y-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" variant="outline" disabled={isClosing || counted === 0}>
              {isClosing ? "Encerrando…" : "Encerrar contagem"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cancelamento                                                               */
/* -------------------------------------------------------------------------- */

export function CancelInventoryForm({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    cancelarInventarioAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
    else if (state?.ok) toast.success(state.message ?? "Inventário cancelado.");
  }, [state]);

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancelar inventário
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="space-y-1.5">
        <label htmlFor="inventory-cancel-reason" className="text-sm font-medium">
          Motivo do cancelamento
        </label>
        <Input id="inventory-cancel-reason" name="reason" required />
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
          {isPending ? "Cancelando…" : "Confirmar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
