import { ATTACHMENT_MAX_DIMENSION } from "@/lib/constants";

/**
 * Compressão de imagem no navegador.
 *
 * Redimensiona para no máximo `ATTACHMENT_MAX_DIMENSION` no maior lado e
 * reencoda em WebP com qualidade 0.8 — o suficiente para uma foto de celular
 * ficar nítida e leve. Roda só no cliente (usa Canvas).
 */

export type CompressedImage = {
  file: File;
  width: number;
  height: number;
};

const QUALITY = 0.8;

function scaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);

  if (longest <= ATTACHMENT_MAX_DIMENSION) return { width, height };

  const ratio = ATTACHMENT_MAX_DIMENSION / longest;

  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

export async function compressImage(file: File): Promise<CompressedImage> {
  // Formatos que o navegador não decodifica com segurança: devolve o original.
  if (!file.type.startsWith("image/")) {
    return { file, width: 0, height: 0 };
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, width: 0, height: 0 };
  }

  const target = scaledSize(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    return { file, width: bitmap.width, height: bitmap.height };
  }

  context.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", QUALITY),
  );

  // Se a compressão falhou ou não compensou, mantém o arquivo original.
  if (!blob || blob.size >= file.size) {
    return { file, width: target.width, height: target.height };
  }

  const name = file.name.replace(/\.[^.]+$/, "") || "imagem";

  return {
    file: new File([blob], `${name}.webp`, { type: "image/webp", lastModified: Date.now() }),
    width: target.width,
    height: target.height,
  };
}
