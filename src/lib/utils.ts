import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Junta classes condicionais resolvendo conflitos do Tailwind.
 *
 * Implementação própria (clsx + tailwind-merge) em vez do pacote `cn` que o
 * CLI do shadcn instala: mantém uma dependência a menos e o comportamento
 * consagrado de merge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
