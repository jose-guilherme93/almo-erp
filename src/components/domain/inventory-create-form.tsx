"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
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
import { criarInventarioAction } from "@/server/actions/inventario";

type Option = { id: string; name: string };

/** Abertura de inventário: define o recorte da contagem. */
export function InventoryCreateForm({
  branchId,
  locations,
  categories,
}: {
  branchId: string;
  locations: Option[];
  categories: Option[];
}) {
  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    criarInventarioAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="branchId" value={branchId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <FormField
        id="inventory-location"
        label="Local de estoque"
        hint="Deixe em branco para contar todos os locais."
      >
        <input type="hidden" name="storageLocationId" value={locationId} />
        <Select
          value={locationId === "" ? "__all__" : locationId}
          onValueChange={(value) => setLocationId(value === "__all__" ? "" : value)}
        >
          <SelectTrigger id="inventory-location" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os locais</SelectItem>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField id="inventory-category" label="Categoria" hint="Opcional. Restringe a contagem.">
        <input type="hidden" name="categoryId" value={categoryId} />
        <Select
          value={categoryId === "" ? "__all__" : categoryId}
          onValueChange={(value) => setCategoryId(value === "__all__" ? "" : value)}
        >
          <SelectTrigger id="inventory-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as categorias</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id="inventory-stale"
        label="Somente sem movimento há N dias"
        hint="Foca a contagem no estoque encravado, que é onde a divergência costuma aparecer."
        errors={fieldErrors["onlyWithoutMovementDays"]}
      >
        <Input
          id="inventory-stale"
          name="onlyWithoutMovementDays"
          type="number"
          min="1"
          placeholder="Ex.: 90"
        />
      </FormField>

      <FormField id="inventory-notes" label="Observação" errors={fieldErrors["notes"]}>
        <Textarea id="inventory-notes" name="notes" rows={2} />
      </FormField>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Abrindo…" : "Abrir inventário"}
      </Button>
    </form>
  );
}
