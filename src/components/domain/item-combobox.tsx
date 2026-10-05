"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ScanBarcode, Search } from "lucide-react";
import { toast } from "sonner";

import { BarcodeScanner } from "@/components/domain/barcode-scanner";
import { FormField } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import { onlyDigits } from "@/lib/format";
import type { ItemPickOption } from "@/lib/item-option";
import { isValidBarcode } from "@/lib/validation/catalog";
import {
  buscarItensAction,
  buscarPorCodigoBarrasAction,
  criarItemRapidoAction,
} from "@/server/actions/item";

export type ItemOption = ItemPickOption;

export type ItemUnitOption = { id: string; code: string; name: string };

/**
 * Seletor de material com busca e leitura de código de barras.
 *
 * É o componente usado em todas as telas que precisam escolher um material
 * (solicitação, entrada, ajuste, transferência, inventário).
 *
 * Quando `canCreate` é verdadeiro, o leitor tem a continuação do caminho: código
 * de barras que não pertence a nenhum material abre o cadastro mínimo **aqui**,
 * sem obrigar o usuário a sair da tela de entrada e montar o material antes.
 */
export function ItemCombobox({
  onSelect,
  units,
  canCreate = false,
  placeholder = "Buscar material por nome, código ou código de barras…",
  autoFocus,
}: {
  onSelect: (item: ItemOption) => void;
  /** Unidades para o cadastro rápido. Vazio (ou `canCreate` falso) desliga a criação. */
  units?: ItemUnitOption[];
  canCreate?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ term: string; items: ItemOption[] }>({
    term: "",
    items: [],
  });
  const [showScanner, setShowScanner] = useState(false);
  /** Código lido sem material correspondente: vira o cadastro rápido. */
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
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
    setUnknownBarcode(null);
  };

  const closeScanner = () => {
    setShowScanner(false);
    setUnknownBarcode(null);
  };

  const handleBarcode = async (code: string) => {
    const result = await buscarPorCodigoBarrasAction(code);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // Material existe: entra direto na linha do documento.
    if (result.data) {
      pick(result.data);
      setShowScanner(false);
      return;
    }

    // Produto novo: sem material cadastrado, seguimos o mesmo caminho aqui.
    if (!canCreate) {
      toast.error("Nenhum material com este código de barras.");
      setShowScanner(false);
      return;
    }

    setUnknownBarcode(onlyDigits(code));
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

      {unknownBarcode !== null ? (
        <QuickItemForm
          barcode={unknownBarcode}
          units={units ?? []}
          onCreated={pick}
          onCancel={closeScanner}
        />
      ) : null}

      {isLoading ? <p className="text-muted-foreground text-xs">Buscando…</p> : null}

      {!isLoading && term.trim().length >= 2 && options.length === 0 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Nenhum material encontrado. Verifique a escrita ou cadastre o material.
          </p>

          {/* Mesmo caminho da câmera, para quem está no balcão sem celular. */}
          {canCreate && isValidBarcode(term) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setUnknownBarcode(onlyDigits(term));
                setTerm("");
              }}
            >
              Cadastrar material com o código {onlyDigits(term)}
            </Button>
          ) : null}
        </div>
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

/**
 * Cadastro mínimo de material, aberto pelo leitor quando o código é desconhecido.
 *
 * Só pede o que não dá para adivinhar: nome e unidade. O SKU é gerado pelo
 * servidor e a categoria é "Geral" — nada disso é responsabilidade de quem está
 * na doca.
 *
 * Não é um `<form>`: este componente vive dentro do formulário do documento, e
 * form aninhado é HTML inválido. A action é chamada direto.
 */
function QuickItemForm({
  barcode,
  units,
  onCreated,
  onCancel,
}: {
  barcode: string;
  units: ItemUnitOption[];
  onCreated: (item: ItemOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState(
    () => units.find((unit) => unit.code === "UN")?.id ?? units[0]?.id ?? "",
  );
  const [result, setResult] = useState<ActionResult<ItemOption> | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit = name.trim().length >= 2 && unitId.length > 0;

  const submit = () => {
    if (!canSubmit) return;

    const formData = new FormData();
    formData.set("name", name);
    formData.set("unitId", unitId);
    formData.set("barcode", barcode);

    startTransition(async () => {
      const response = await criarItemRapidoAction(null, formData);

      if (response.ok) onCreated(response.data);
      else setResult(response);
    });
  };

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Material novo</p>
      <p className="text-muted-foreground text-xs">
        Código {barcode} ainda não cadastrado. Informe o nome e a unidade para já adicionar à
        entrada.
      </p>

      <FormField
        id="quick-item-name"
        label="Nome do material"
        required
        errors={fieldErrors["name"]}
      >
        <Input
          id="quick-item-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ex.: Luva de raspa"
          aria-label="Nome do material"
          autoFocus
        />
      </FormField>

      <FormField id="quick-item-unit" label="Unidade" required errors={fieldErrors["unitId"]}>
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger id="quick-item-unit" className="w-full">
            <SelectValue placeholder="Selecione a unidade" />
          </SelectTrigger>
          <SelectContent>
            {units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.code} — {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {result && !result.ok ? <p className="text-destructive text-sm">{result.error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={isPending || !canSubmit} onClick={submit}>
          {isPending ? "Cadastrando…" : "Cadastrar e adicionar"}
        </Button>

        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
