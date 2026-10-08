/**
 * Material no formato que o seletor da interface consome.
 *
 * Vive em `lib` porque é consumido pelo componente cliente (`ItemCombobox`) e
 * pelo serviço do catálogo, e §4 do AGENTS.md proíbe componente cliente
 * importar de `server/`.
 */
export type ItemPickOption = {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  controlledByLot: boolean;
  hasSerialControl: boolean;
  /** Série implica patrimônio; desmarcado, o material não gera bem. */
  trackAsAsset: boolean;
  unit: { id: string; code: string; name: string; allowsDecimals: boolean };
  category: { id: string; name: string };
};
