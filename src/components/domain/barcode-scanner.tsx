"use client";

import { Camera, CameraOff, Keyboard } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Leitor de código de barras pela câmera.
 *
 * O `@zxing/browser` é carregado sob demanda (dynamic import): são ~200 kB que
 * não fazem sentido no bundle inicial de quem só vai digitar a quantidade. É
 * JavaScript puro, sem WebAssembly — por isso não depende de `wasm-unsafe-eval`
 * na CSP.
 *
 * A entrada manual **não é um extra**: o notebook do almoxarifado
 * frequentemente não tem câmera, a permissão pode estar negada e `getUserMedia`
 * só existe em contexto seguro (HTTPS ou localhost). Sem esse caminho, a tela
 * ficaria inutilizável.
 *
 * O leitor só é inicializado **depois** que o `<video>` existe. Ler a ref antes
 * do `setMode("scanning")` devolve `null` e a câmera nunca sobe — foi exatamente
 * o que aconteceu até o fluxo ser reescrito em efeito.
 */
export function BarcodeScanner({
  onDetected,
  label = "Leitor de código de barras",
}: {
  onDetected: (code: string) => void;
  label?: string;
}) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  const [mode, setMode] = useState<"idle" | "scanning" | "manual">("idle");
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  // O pai passa uma função nova a cada render; guardá-la em ref evita que o
  // efeito da câmera reinicie o stream a cada tecla digitada na tela.
  const detectedRef = useRef(onDetected);

  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  const startCamera = useCallback(() => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo não tem câmera disponível. Use a digitação manual.");
      setMode("manual");
      return;
    }

    // Só monta o <video>; o stream é pedido no efeito abaixo.
    setMode("scanning");
  }, []);

  // Leitor ligado ao elemento já montado.
  useEffect(() => {
    if (mode !== "scanning" || !videoEl) return;

    let cancelled = false;

    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");

        if (cancelled) return;

        const reader = new BrowserMultiFormatReader();

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoEl,
          (result) => {
            if (!result || cancelled) return;

            detectedRef.current(result.getText());

            stopCamera();
            setMode("idle");
          },
        );

        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch {
        if (cancelled) return;

        // Sem permissão, câmera ocupada ou contexto inseguro: cai no digitar.
        setError("Não foi possível acessar a câmera. Use a digitação manual.");
        setMode("manual");
      }
    };

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [mode, videoEl, stopCamera]);

  // Libera a câmera se o componente sair da tela — deixar a luz acesa é
  // constrangedor e consome bateria.
  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <div className="space-y-2">
      <Label htmlFor="barcode-manual">{label}</Label>

      <div className="flex flex-wrap gap-2">
        {mode === "scanning" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              stopCamera();
              setMode("idle");
            }}
          >
            <CameraOff className="size-4" />
            Parar câmera
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={startCamera}>
            <Camera className="size-4" />
            Usar câmera
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMode(mode === "manual" ? "idle" : "manual")}
        >
          <Keyboard className="size-4" />
          Digitar código
        </Button>
      </div>

      {mode === "scanning" ? (
        <div className="overflow-hidden rounded-md border">
          <video
            ref={setVideoEl}
            className="bg-muted aspect-video w-full object-cover"
            muted
            playsInline
          />
        </div>
      ) : null}

      {mode === "manual" ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const code = manualCode.trim();
            if (code.length === 0) return;
            detectedRef.current(code);
            setManualCode("");
          }}
        >
          <Input
            id="barcode-manual"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="Digite o código de barras e pressione Enter"
            inputMode="numeric"
            autoFocus
          />
          <Button type="submit" size="sm">
            Buscar
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-muted-foreground text-xs">{error}</p> : null}
    </div>
  );
}
