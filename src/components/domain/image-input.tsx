"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/image-compression";

type Preview = { id: string; url: string; name: string; size: number };

const MAX_FILES_DEFAULT = 5;

/**
 * Campo de anexo de imagem.
 *
 * Comprime cada arquivo no próprio navegador (WebP) e reescreve o `input` com
 * os arquivos comprimidos — assim o submit do formulário já leva a versão leve,
 * sem precisar de upload separado.
 */
export function ImageInput({
  name = "fotos",
  label = "Fotos (opcional)",
  hint = "A imagem é comprimida automaticamente antes de enviar.",
  maxFiles = MAX_FILES_DEFAULT,
}: {
  name?: string;
  label?: string;
  hint?: string;
  maxFiles?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).slice(0, maxFiles);

    if (selected.length === 0) {
      setPreviews([]);
      return;
    }

    setBusy(true);

    try {
      const compressed = await Promise.all(selected.map((file) => compressImage(file)));

      const transfer = new DataTransfer();
      const nextPreviews: Preview[] = compressed.map((item, index) => {
        transfer.items.add(item.file);

        return {
          id: `${index}-${item.file.name}`,
          url: URL.createObjectURL(item.file),
          name: item.file.name,
          size: item.file.size,
        };
      });

      // Reescreve o input com os arquivos comprimidos: é o que o form envia.
      if (inputRef.current) inputRef.current.files = transfer.files;

      setPreviews((current) => {
        current.forEach((preview) => URL.revokeObjectURL(preview.url));
        return nextPreviews;
      });
    } catch {
      toast.error("Não foi possível processar a imagem. Tente outra foto.");
      if (inputRef.current) inputRef.current.value = "";
      setPreviews([]);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    if (inputRef.current) inputRef.current.value = "";
    setPreviews((current) => {
      current.forEach((preview) => URL.revokeObjectURL(preview.url));
      return [];
    });
  };

  const totalKb = Math.round(previews.reduce((total, preview) => total + preview.size, 0) / 1024);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`image-input-${name}`} className="text-sm font-medium">
          {label}
        </label>

        {previews.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <X className="size-3.5" />
            Limpar
          </Button>
        ) : null}
      </div>

      <label
        htmlFor={`image-input-${name}`}
        className="hover:border-primary/50 flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-3 text-sm"
      >
        <ImagePlus className="text-muted-foreground size-5" aria-hidden />
        <span className="text-muted-foreground">
          {busy ? "Comprimindo…" : "Tirar foto ou escolher da galeria"}
        </span>
      </label>

      <input
        ref={inputRef}
        id={`image-input-${name}`}
        name={name}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="sr-only"
        onChange={handleChange}
        aria-describedby={`image-input-hint-${name}`}
      />

      <p id={`image-input-hint-${name}`} className="text-muted-foreground text-xs">
        {hint} Até {maxFiles} imagens.
        {previews.length > 0 ? ` ${totalKb} KB no total.` : ""}
      </p>

      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {previews.map((preview) => (
            <li key={preview.id} className="overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.url}
                alt={preview.name}
                className="h-20 w-20 object-cover"
                width={80}
                height={80}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
