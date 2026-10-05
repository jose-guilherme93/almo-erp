"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Impressão do relatório consolidado.
 *
 * O "PDF" sai da impressão do navegador (Salvar como PDF): sem dependência de
 * geração de PDF no servidor. O conteúdo impresso é o snapshot congelado.
 */
export function PrintButton({ label = "Imprimir / Salvar PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      {label}
    </Button>
  );
}
