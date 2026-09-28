"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trocarFilialAtivaAction } from "@/server/actions/branch-context";
import { cn } from "@/lib/utils";

export type BranchOption = {
  id: string;
  code: string;
  name: string;
  roleName: string;
};

/**
 * Seletor de unidade ativa.
 *
 * Só aparece para quem atua em mais de uma unidade. Trocar aqui muda o escopo
 * de todas as listagens — por isso mostramos a unidade ativa de forma
 * destacada no cabeçalho (o usuário nunca pode ficar em dúvida onde está
 * operando).
 */
export function BranchSwitcher({
  branches,
  activeBranchId,
}: {
  branches: BranchOption[];
  activeBranchId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (branches.length <= 1) return null;

  const active = branches.find((branch) => branch.id === activeBranchId) ?? branches[0];

  const select = (branchId: string) => {
    setOpen(false);

    if (branchId === activeBranchId) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("branchId", branchId);

      const result = await trocarFilialAtivaAction(null, formData);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Unidade alterada.");
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Selecionar unidade"
          disabled={isPending}
          className="max-w-[16rem] justify-between gap-2"
          size="sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">{active?.code ?? "Unidade"}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar unidade…" />
          <CommandList>
            <CommandEmpty>Nenhuma unidade encontrada.</CommandEmpty>

            <CommandGroup heading="Unidades com acesso">
              {branches.map((branch) => (
                <CommandItem
                  key={branch.id}
                  value={`${branch.code} ${branch.name}`}
                  onSelect={() => select(branch.id)}
                  className="flex items-start gap-2"
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      branch.id === activeBranchId ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{branch.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {branch.code} · {branch.roleName}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
