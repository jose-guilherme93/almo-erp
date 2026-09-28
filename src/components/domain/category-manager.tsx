"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import {
  atualizarCategoriaAction,
  criarCategoriaAction,
  desativarCategoriaAction,
} from "@/server/actions/catalogo";
import { cn } from "@/lib/utils";

export type CategoryNode = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  requiresApproval: boolean;
  active: boolean;
  itemCount: number;
  depth: number;
};

export type CategoryOption = { id: string; label: string };

/**
 * Árvore de categorias.
 *
 * A hierarquia importa para relatórios ("EPI" soma todas as subcategorias) e
 * para a regra de aprovação, que pode ser definida no nível da raiz.
 */
export function CategoryManager({
  categories,
  parentOptions,
  canManage,
}: {
  categories: CategoryNode[];
  parentOptions: CategoryOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<CategoryNode | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);

  const close = useCallback(() => {
    setEditing(null);
    setCreatingUnder(null);
  }, []);

  const [state, action, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    desativarCategoriaAction,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) toast.success(state.message ?? "Categoria desativada.");
    else toast.error(state.error);
  }, [state]);

  const isFormOpen = editing !== null || creatingUnder !== null;

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {categories.length === 0 ? (
          <li className="text-muted-foreground p-4 text-sm">
            Nenhuma categoria cadastrada. Materiais precisam de categoria.
          </li>
        ) : (
          categories.map((category) => (
            <li
              key={category.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              style={{ paddingLeft: `${12 + category.depth * 20}px` }}
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {category.depth > 0 ? (
                    <span className="text-muted-foreground mr-1" aria-hidden>
                      ↳
                    </span>
                  ) : null}
                  {category.name}
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    {category.code}
                  </span>
                  {category.requiresApproval ? (
                    <Badge variant="outline" className="ml-2">
                      exige aprovação
                    </Badge>
                  ) : null}
                  {!category.active ? (
                    <Badge variant="outline" className="ml-2">
                      inativa
                    </Badge>
                  ) : null}
                </p>
                {category.description ? (
                  <p className="text-muted-foreground truncate text-xs">{category.description}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {category.itemCount} material(is)
                </span>

                {canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCreatingUnder(category.id);
                        setEditing(null);
                      }}
                    >
                      <Plus className="size-4" />
                      Subcategoria
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(category);
                        setCreatingUnder(null);
                      }}
                    >
                      <Pencil className="size-4" />
                      Editar
                    </Button>

                    {category.active ? (
                      <form action={action}>
                        <input type="hidden" name="categoryId" value={category.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={isPending}
                          aria-label={`Desativar ${category.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        isFormOpen ? (
          <CategoryForm
            key={editing?.id ?? creatingUnder ?? "nova"}
            category={editing}
            defaultParentId={creatingUnder}
            parentOptions={parentOptions}
            onDone={close}
          />
        ) : (
          <Button type="button" variant="outline" onClick={() => setCreatingUnder("")}>
            <Plus className="size-4" />
            Nova categoria
          </Button>
        )
      ) : null}
    </div>
  );
}

function CategoryForm({
  category,
  defaultParentId,
  parentOptions,
  onDone,
}: {
  category: CategoryNode | null;
  defaultParentId: string | null;
  parentOptions: CategoryOption[];
  onDone: () => void;
}) {
  const isEdit = category !== null;
  const action = isEdit ? atualizarCategoriaAction : criarCategoriaAction;

  const [parentId, setParentId] = useState(category?.parentId ?? defaultParentId ?? "");
  const [requiresApproval, setRequiresApproval] = useState(category?.requiresApproval ?? false);
  const [active, setActive] = useState(category?.active ?? true);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Categoria salva.");
      onDone();
    } else {
      toast.error(state.error);
    }
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-4 rounded-md border p-3">
      {isEdit && category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
      <input type="hidden" name="parentId" value={parentId} />
      <input type="hidden" name="requiresApproval" value={requiresApproval ? "on" : ""} />
      <input type="hidden" name="active" value={active ? "on" : ""} />

      <p className="text-sm font-medium">
        {isEdit ? `Editar ${category?.name}` : "Nova categoria"}
      </p>

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="category-code" label="Código" required errors={fieldErrors["code"]}>
          <Input
            id="category-code"
            name="code"
            defaultValue={category?.code}
            className="uppercase"
            required
          />
        </FormField>

        <FormField id="category-name" label="Nome" required errors={fieldErrors["name"]}>
          <Input id="category-name" name="name" defaultValue={category?.name} required />
        </FormField>

        <FormField
          id="category-parent"
          label="Categoria superior"
          hint="Deixe em branco para criar uma categoria raiz."
          className="sm:col-span-2"
        >
          <Select
            value={parentId === "" ? "__root__" : parentId}
            onValueChange={(value) => setParentId(value === "__root__" ? "" : value)}
          >
            <SelectTrigger id="category-parent" className="w-full">
              <SelectValue placeholder="Categoria raiz" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__root__">Nenhuma (categoria raiz)</SelectItem>
              {parentOptions
                .filter((option) => option.id !== category?.id)
                .map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="category-description"
          label="Descrição"
          className="sm:col-span-2"
          errors={fieldErrors["description"]}
        >
          <Textarea
            id="category-description"
            name="description"
            defaultValue={category?.description ?? ""}
            rows={2}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={requiresApproval}
            onCheckedChange={(value) => setRequiresApproval(value === true)}
          />
          Materiais desta categoria exigem aprovação
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
          Ativa
        </label>
      </div>

      <div className={cn("flex gap-2")}>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Salvando…" : isEdit ? "Salvar" : "Criar categoria"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
