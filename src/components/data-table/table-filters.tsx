"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Filtros de listagem.
 *
 * Componentes cliente porque precisam reagir à digitação — mas o **estado
 * continua na URL**: eles apenas navegam com `router.replace`. Sem estado
 * duplicado de dados do servidor (AGENTS.md §5).
 */

function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const apply = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(changes)) {
        params.delete(key);
        if (value !== null && value !== "") params.set(key, value);
      }

      // Qualquer mudança de filtro volta para a primeira página.
      params.delete("pagina");

      const query = params.toString();

      startTransition(() => {
        router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  return { apply, isPending, searchParams };
}

export function TableSearch({
  paramKey = "busca",
  placeholder = "Buscar…",
  className,
}: {
  paramKey?: string;
  placeholder?: string;
  className?: string;
}) {
  const { apply, isPending, searchParams } = useUrlFilters();
  const currentValue = searchParams.get(paramKey) ?? "";
  const [value, setValue] = useState(currentValue);
  const [lastUrlValue, setLastUrlValue] = useState(currentValue);
  const isFirstRender = useRef(true);

  // Sincroniza quando a URL muda por fora (botão voltar/avançar do navegador).
  // Ajustar o estado durante a renderização é o padrão recomendado pelo React
  // para "estado derivado de prop" — evita o render em cascata de um efeito.
  if (currentValue !== lastUrlValue) {
    setLastUrlValue(currentValue);
    setValue(currentValue);
  }

  // Debounce: só navega 350 ms depois que o usuário para de digitar.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (value === currentValue) return;

    const timeout = setTimeout(() => apply({ [paramKey]: value || null }), 350);

    return () => clearTimeout(timeout);
  }, [value, currentValue, apply, paramKey]);

  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />

      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
        data-pending={isPending ? "" : undefined}
      />

      {value.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
          onClick={() => setValue("")}
          aria-label="Limpar busca"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

export type TableFilterOption = { value: string; label: string };

export function TableFilterSelect({
  paramKey,
  placeholder,
  options,
  allLabel = "Todos",
  className,
}: {
  paramKey: string;
  placeholder: string;
  options: TableFilterOption[];
  allLabel?: string;
  className?: string;
}) {
  const { apply, searchParams } = useUrlFilters();
  const value = searchParams.get(paramKey) ?? "";

  return (
    <Select
      value={value}
      onValueChange={(next) => apply({ [paramKey]: next === "all" ? null : next })}
    >
      <SelectTrigger className={cn("w-full sm:w-52", className)} aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>

      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Botão "limpar filtros" que só aparece quando há algo filtrado. */
export function ClearFilters({ paramKeys }: { paramKeys: string[] }) {
  const { apply, searchParams } = useUrlFilters();
  const hasAny = paramKeys.some((key) => (searchParams.get(key) ?? "").length > 0);

  if (!hasAny) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => apply(Object.fromEntries(paramKeys.map((key) => [key, null])))}
    >
      Limpar filtros
    </Button>
  );
}
