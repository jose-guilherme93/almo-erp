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
 * não fazem sentido no bundle inicial de quem só vai digitar a quantidade.
 *
 * A entrada manual **não é um extra**: o notebook do almoxarifado
 * frequentemente não tem câmera, e a permissão pode estar negada. Sem esse
 * caminho, a tela ficaria inutilizável.
 */
export function BarcodeScanner({
  onDetected,
  label = "Leitor de código de barras",
}: {
  onDetected: (code: string) => void;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  const [mode, setMode] = useState<"idle" | "scanning" | "manual">("idle");
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo não tem câmera disponível. Use a digitação manual.");
      setMode("manual");
      return;
    }

    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();

      const video = videoRef.current;
      if (!video) return;

      setMode("scanning");

      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        video,
        (result) => {
          if (!result) return;
          onDetected(result.getText());
          stopCamera();
          setMode("idle");
        },
      );

      controlsRef.current = controls;
    } catch {
      setError("Não foi possível acessar a câmera. Use a digitação manual.");
      setMode("manual");
    }
  }, [onDetected, stopCamera]);

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
            ref={videoRef}
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
            onDetected(code);
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
