"use client";

import { ScanBarcode, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BarcodeScanner } from "@/components/domain/barcode-scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buscarItensAction, buscarPorCodigoBarrasAction } from "@/server/actions/item";

export type ItemOption = {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  controlledByLot: boolean;
  unit: { code: string; allowsDecimals: boolean };
  category: { name: string };
};

/**
 * Seletor de material com busca e leitura de código de barras.
 *
 * É o componente usado em todas as telas que precisam escolher um material
 * (solicitação, entrada, ajuste, transferência, inventário).
 */
export function ItemCombobox({
  onSelect,
  placeholder = "Buscar material por nome, código ou código de barras…",
  autoFocus,
}: {
  onSelect: (item: ItemOption) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ term: string; items: ItemOption[] }>({
    term: "",
    items: [],
  });
  const [showScanner, setShowScanner] = useState(false);
  const requestId = useRef(0);

  // Só exibimos resultados que correspondem ao termo atual: enquanto a busca
  // está em voo, a lista some em vez de mostrar dado velho. Derivar isso na
  // renderização evita um setState síncrono dentro do efeito.
  const isSearchable = term.trim().length >= 2;
  const options = isSearchable && results.term === term ? results.items : [];
  // "Carregando" também é derivado: a lista está defasada em relação ao termo.
  const isLoading = isSearchable && results.term !== term;

  // A busca em si só atualiza estado dentro do callback assíncrono.
  useEffect(() => {
    if (!isSearchable) return;

    const current = ++requestId.current;

    const timeout = setTimeout(async () => {
      const result = await buscarItensAction(term);

      if (current !== requestId.current) return;

      setResults({ term, items: result.ok ? result.data : [] });
    }, 300);

    return () => clearTimeout(timeout);
  }, [term, isSearchable]);

  const pick = (item: ItemOption) => {
    onSelect(item);
    setTerm("");
    setResults({ term: "", items: [] });
  };

  const handleBarcode = async (code: string) => {
    const result = await buscarPorCodigoBarrasAction(code);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const item = result.data;

    pick({
      id: item.id,
      code: item.code,
      barcode: item.barcode,
      name: item.name,
      controlledByLot: item.controlledByLot,
      unit: { code: item.unit.code, allowsDecimals: false },
      category: item.category,
    });

    setShowScanner(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pl-8"
            autoFocus={autoFocus}
            autoComplete="off"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowScanner((current) => !current)}
          aria-label="Ler código de barras"
          aria-expanded={showScanner}
        >
          <ScanBarcode className="size-4" />
        </Button>
      </div>

      {showScanner ? <BarcodeScanner onDetected={handleBarcode} /> : null}

      {isLoading ? <p className="text-muted-foreground text-xs">Buscando…</p> : null}

      {!isLoading && term.trim().length >= 2 && options.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Nenhum material encontrado. Verifique a escrita ou cadastre o material.
        </p>
      ) : null}

      {options.length > 0 ? (
        <ul className="max-h-72 overflow-y-auto rounded-md border" role="listbox">
          {options.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(item)}
                className="hover:bg-accent focus-visible:bg-accent w-full px-3 py-2 text-left text-sm outline-none"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {item.code} · {item.unit.code} · {item.category.name}
                    </span>
                  </span>

                  {item.controlledByLot ? (
                    <Badge variant="outline" className="shrink-0">
                      lote
                    </Badge>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
