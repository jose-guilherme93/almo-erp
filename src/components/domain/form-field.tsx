import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Campo de formulário com rótulo, dica e erro.
 *
 * Recebe as mensagens de erro já resolvidas do `ActionResult.fieldErrors`
 * (AGENTS.md §6: erro por campo, rótulo associado, `aria-*` correto).
 */
export function FormField({
  id,
  label,
  hint,
  errors,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const hasError = (errors?.length ?? 0) > 0;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive ml-0.5" aria-hidden>
            *
          </span>
        ) : null}
      </Label>

      {children}

      {hasError ? (
        <p id={`${id}-erro`} role="alert" className="text-destructive text-xs">
          {errors?.join(" ")}
        </p>
      ) : hint ? (
        <p id={`${id}-dica`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Mensagem de erro geral do formulário (não vinculada a um campo). */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
    >
      {message}
    </p>
  );
}
