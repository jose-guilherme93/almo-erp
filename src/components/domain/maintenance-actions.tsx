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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { MAINTENANCE_PRIORITIES } from "@/lib/validation/maintenance";
import {
  assumirReparoAction,
  atribuirReparoAction,
  atualizarAndamentoReparoAction,
  cancelarReparoAction,
  concluirReparoAction,
  definirPrioridadeReparoAction,
  recusarReparoAction,
} from "@/server/actions/manutencao";

type Mode =
  "none" | "priority" | "assign" | "progress" | "waiting" | "complete" | "reject" | "cancel";

/**
 * Ações do chamado de reparo.
 *
 * O bloco central é o de **prioridade**: quem recebe é que decide se é urgente,
 * porque é quem conhece a fila e o impacto na operação.
 */
export function MaintenanceActions({
  requestId,
  status,
  priority,
  assignees,
  canAttend,
  isOwner,
}: {
  requestId: string;
  status: string;
  priority: string | null;
  assignees: Array<{ id: string; name: string }>;
  canAttend: boolean;
  isOwner: boolean;
}) {
  const [mode, setMode] = useState<Mode>("none");
  const [selectedPriority, setSelectedPriority] = useState(priority ?? "NORMAL");
  const [assignedToId, setAssignedToId] = useState("");
  const [progressStatus, setProgressStatus] = useState<"IN_PROGRESS" | "WAITING_PARTS">(
    "IN_PROGRESS",
  );

  const [claimState, claimAction, isClaiming] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(assumirReparoAction, null);

  const [priorityState, priorityAction, isSettingPriority] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(definirPrioridadeReparoAction, null);

  const [assignState, assignAction, isAssigning] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(atribuirReparoAction, null);

  const [progressState, progressAction, isUpdating] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(atualizarAndamentoReparoAction, null);

  const [completeState, completeAction, isCompleting] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(concluirReparoAction, null);

  const [rejectState, rejectAction, isRejecting] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(recusarReparoAction, null);

  const [cancelState, cancelAction, isCancelling] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(cancelarReparoAction, null);

  const states = [
    claimState,
    priorityState,
    assignState,
    progressState,
    completeState,
    rejectState,
    cancelState,
  ];

  useEffect(() => {
    for (const state of states) {
      if (!state) continue;
      if (state.ok) toast.success(state.message ?? "Chamado atualizado.");
      else toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    claimState,
    priorityState,
    assignState,
    progressState,
    completeState,
    rejectState,
    cancelState,
  ]);

  const failed = states.find((state) => state !== null && !state.ok);

  const error = failed && !failed.ok ? failed.error : null;

  const isClosed = ["DONE", "REJECTED", "CANCELLED"].includes(status);
  const canCancel = !isClosed && (isOwner || canAttend);

  // A `key` muda a cada ação bem-sucedida: o bloco é remontado e o formulário
  // aberto fecha sozinho, sem precisar de setState dentro de um efeito.
  const successKey = states.filter((state) => state?.ok === true).length;

  return (
    <div key={successKey} className="space-y-4">
      {error ? <FormError message={error} /> : null}

      {!canAttend && !isClosed ? (
        <p className="text-muted-foreground text-sm">
          A equipe de manutenção da unidade acompanha este chamado. Você é avisado a cada mudança.
        </p>
      ) : null}

      {canAttend && !isClosed ? (
        <div className="flex flex-wrap gap-2">
          {status === "OPEN" ? (
            <form action={claimAction}>
              <input type="hidden" name="requestId" value={requestId} />
              <Button type="submit" variant="outline" disabled={isClaiming}>
                {isClaiming ? "Assumindo…" : "Assumir chamado"}
              </Button>
            </form>
          ) : null}

          <Button type="button" onClick={() => setMode("priority")}>
            Definir prioridade
          </Button>

          {assignees.length > 0 ? (
            <Button type="button" variant="outline" onClick={() => setMode("assign")}>
              Atribuir a alguém
            </Button>
          ) : null}

          {status === "IN_PROGRESS" || status === "WAITING_PARTS" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setMode("progress")}>
                Registrar andamento
              </Button>
              <Button type="button" variant="outline" onClick={() => setMode("waiting")}>
                Aguardando peça
              </Button>
              <Button type="button" onClick={() => setMode("complete")}>
                Concluir
              </Button>
            </>
          ) : null}

          {status === "OPEN" || status === "IN_REVIEW" ? (
            <Button type="button" variant="ghost" onClick={() => setMode("reject")}>
              Recusar
            </Button>
          ) : null}
        </div>
      ) : null}

      {canCancel && mode === "none" && !isClosed ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("cancel")}>
          Cancelar chamado
        </Button>
      ) : null}

      {mode === "priority" ? (
        <form action={priorityAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="priority" value={selectedPriority} />

          <FormField
            id="priority"
            label="Prioridade"
            hint="Você decide: quem abriu não sabe o impacto na operação."
          >
            <Select value={selectedPriority} onValueChange={setSelectedPriority}>
              <SelectTrigger id="priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_PRIORITIES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} — {option.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="priority-comment" label="Observação">
            <Input id="priority-comment" name="comment" />
          </FormField>

          <FormActions
            isPending={isSettingPriority}
            label="Salvar prioridade"
            onCancel={() => setMode("none")}
          />
        </form>
      ) : null}

      {mode === "assign" ? (
        <form action={assignAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="assignedToId" value={assignedToId} />

          <FormField id="assignee" label="Quem vai atender" required>
            <Select value={assignedToId} onValueChange={setAssignedToId}>
              <SelectTrigger id="assignee" className="w-full">
                <SelectValue placeholder="Escolha a pessoa" />
              </SelectTrigger>
              <SelectContent>
                {assignees.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="assign-comment" label="Observação">
            <Input id="assign-comment" name="comment" />
          </FormField>

          <FormActions
            isPending={isAssigning}
            label="Atribuir e iniciar"
            disabled={!assignedToId}
            onCancel={() => setMode("none")}
          />
        </form>
      ) : null}

      {mode === "progress" || mode === "waiting" ? (
        <form action={progressAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input
            type="hidden"
            name="status"
            value={mode === "waiting" ? "WAITING_PARTS" : progressStatus}
          />

          {mode === "progress" ? (
            <FormField id="progress-status" label="Situação">
              <Select
                value={progressStatus}
                onValueChange={(value) =>
                  setProgressStatus(value as "IN_PROGRESS" | "WAITING_PARTS")
                }
              >
                <SelectTrigger id="progress-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_PROGRESS">Em andamento</SelectItem>
                  <SelectItem value="WAITING_PARTS">Aguardando peça</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          <FormField
            id="progress-comment"
            label="O que aconteceu"
            required
            hint="Ex.: peça encomendada, previsão de 3 dias."
          >
            <Textarea id="progress-comment" name="comment" rows={2} required />
          </FormField>

          <FormActions
            isPending={isUpdating}
            label={mode === "waiting" ? "Marcar aguardando peça" : "Registrar andamento"}
            onCancel={() => setMode("none")}
          />
        </form>
      ) : null}

      {mode === "complete" ? (
        <form action={completeAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />

          <FormField
            id="resolution"
            label="O que foi feito"
            required
            hint="Fica no histórico do equipamento e ajuda no próximo chamado."
          >
            <Textarea id="resolution" name="resolution" rows={3} required />
          </FormField>

          <FormActions
            isPending={isCompleting}
            label="Concluir chamado"
            onCancel={() => setMode("none")}
          />
        </form>
      ) : null}

      {mode === "reject" ? (
        <form action={rejectAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />

          <FormField id="reject-reason" label="Motivo da recusa" required>
            <Textarea id="reject-reason" name="reason" rows={3} required />
          </FormField>

          <FormActions
            isPending={isRejecting}
            label="Recusar chamado"
            variant="destructive"
            onCancel={() => setMode("none")}
          />
        </form>
      ) : null}

      {mode === "cancel" ? (
        <form action={cancelAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />

          <FormField id="cancel-reason" label="Motivo do cancelamento">
            <Input id="cancel-reason" name="reason" />
          </FormField>

          <FormActions
            isPending={isCancelling}
            label="Cancelar chamado"
            variant="destructive"
            onCancel={() => setMode("none")}
          />
        </form>
      ) : null}
    </div>
  );
}

function FormActions({
  isPending,
  label,
  variant = "default",
  disabled,
  onCancel,
}: {
  isPending: boolean;
  label: string;
  variant?: "default" | "destructive";
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button type="submit" size="sm" variant={variant} disabled={isPending || disabled}>
        {isPending ? "Salvando…" : label}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
        Voltar
      </Button>
    </div>
  );
}
