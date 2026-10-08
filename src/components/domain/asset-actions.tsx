"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type AssetStatusKey } from "@/components/domain/asset-status-badge";
import type { ActionResult } from "@/lib/action-result";
import {
  atribuirPatrimonioAction,
  baixarPatrimonioAction,
  devolverPatrimonioAction,
  transferirPatrimonioAction,
} from "@/server/actions/patrimonio";

/**
 * Ações da ficha do bem: atribuir responsável, devolver e dar baixa.
 *
 * Cada ação é um formulário próprio; o servidor revalida e a ficha recarrega com
 * o novo estado e o novo evento no histórico.
 */
export function AssetActions({
  assetId,
  status,
  users,
  branches,
}: {
  assetId: string;
  status: AssetStatusKey;
  users: Array<{ id: string; name: string }>;
  /** Unidades de destino possíveis (todas menos a atual, no escopo do usuário). */
  branches: Array<{ id: string; name: string }>;
}) {
  const [custodian, setCustodian] = useState("");
  const [destination, setDestination] = useState("");

  const [assignState, assignAction, assignPending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(atribuirPatrimonioAction, null);
  const [returnState, returnAction, returnPending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(devolverPatrimonioAction, null);
  const [retireState, retireAction, retirePending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(baixarPatrimonioAction, null);
  const [transferState, transferAction, transferPending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(transferirPatrimonioAction, null);

  useEffect(() => {
    if (assignState?.ok) toast.success("Responsável definido.");
    else if (assignState && !assignState.ok) toast.error(assignState.error);
  }, [assignState]);

  useEffect(() => {
    if (returnState?.ok) toast.success("Bem devolvido ao almoxarifado.");
    else if (returnState && !returnState.ok) toast.error(returnState.error);
  }, [returnState]);

  useEffect(() => {
    if (retireState?.ok) toast.success("Bem baixado.");
    else if (retireState && !retireState.ok) toast.error(retireState.error);
  }, [retireState]);

  useEffect(() => {
    if (transferState?.ok) toast.success("Bem transferido.");
    else if (transferState && !transferState.ok) toast.error(transferState.error);
  }, [transferState]);

  if (status === "RETIRED") {
    return (
      <p className="text-muted-foreground text-sm">
        Este bem foi baixado e não recebe mais movimentação.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {status !== "IN_USE" ? (
        <form action={assignAction} className="space-y-3">
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="custodianUserId" value={custodian} />

          {assignState && !assignState.ok ? <FormError message={assignState.error} /> : null}

          <FormField id="asset-custodian" label="Entregar a" required>
            <Select value={custodian} onValueChange={setCustodian}>
              <SelectTrigger id="asset-custodian" className="w-full">
                <SelectValue placeholder="Selecione o responsável" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <Button type="submit" disabled={assignPending || custodian === ""}>
            {assignPending ? "Atribuindo…" : "Colocar sob responsabilidade"}
          </Button>
        </form>
      ) : (
        <form action={returnAction} className="space-y-3">
          <input type="hidden" name="assetId" value={assetId} />
          {returnState && !returnState.ok ? <FormError message={returnState.error} /> : null}
          <p className="text-muted-foreground text-sm">
            O bem volta para o almoxarifado (dono padrão) e sai da posse do responsável.
          </p>
          <Button type="submit" variant="outline" disabled={returnPending}>
            {returnPending ? "Devolvendo…" : "Devolver ao almoxarifado"}
          </Button>
        </form>
      )}

      {status === "IN_STOCK" && branches.length > 0 ? (
        <form action={transferAction} className="space-y-3">
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="destinationBranchId" value={destination} />

          {transferState && !transferState.ok ? <FormError message={transferState.error} /> : null}

          <FormField
            id="asset-destination"
            label="Transferir para outra unidade"
            hint="O bem vai para o almoxarifado da unidade escolhida e continua sem responsável."
          >
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger id="asset-destination" className="w-full">
                <SelectValue placeholder="Selecione a unidade de destino" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <Button type="submit" variant="outline" disabled={transferPending || destination === ""}>
            {transferPending ? "Transferindo…" : "Transferir bem"}
          </Button>
        </form>
      ) : null}

      <form action={retireAction} className="border-destructive/40 space-y-3 rounded-md border p-3">
        <input type="hidden" name="assetId" value={assetId} />
        {retireState && !retireState.ok ? <FormError message={retireState.error} /> : null}

        <FormField
          id="asset-retire-reason"
          label="Dar baixa"
          required
          hint="Descreva o motivo (perda, doação, fim da vida útil). Fica no histórico."
        >
          <Textarea id="asset-retire-reason" name="reason" rows={2} />
        </FormField>

        <Button type="submit" variant="destructive" disabled={retirePending}>
          {retirePending ? "Baixando…" : "Baixar bem"}
        </Button>
      </form>
    </div>
  );
}
