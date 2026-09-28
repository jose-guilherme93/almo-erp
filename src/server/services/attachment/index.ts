import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_BYTES } from "@/lib/constants";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";

const log = logger.with({ service: "attachment" });

/**
 * Anexos de imagem.
 *
 * A compressão acontece no navegador (WebP, maior lado limitado) — aqui o
 * arquivo já chega leve. O binário fica em disco (`UPLOAD_DIR`); o banco guarda
 * só os metadados. O download passa por um route handler que valida a
 * visibilidade da entidade pai.
 */

const MAX_FILES = 5;

export function uploadsDir(): string {
  return process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), "var", "uploads");
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AttachmentInput = {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  checksum?: string | null;
};

function isUsableFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as File).arrayBuffer === "function" &&
    (value as File).size > 0
  );
}

/**
 * Grava os arquivos recebidos no formulário e devolve os metadados.
 *
 * Não toca no banco: a criação das linhas acontece na transação que cria a
 * solicitação/chamado, para o conjunto ser atômico do ponto de vista do banco.
 */
export async function storeUploadedImages(files: FormDataEntryValue[]): Promise<AttachmentInput[]> {
  const usable = files.filter(isUsableFile).slice(0, MAX_FILES);

  const stored: AttachmentInput[] = [];

  for (const file of usable) {
    if (!ATTACHMENT_ALLOWED_MIME.includes(file.type as (typeof ATTACHMENT_ALLOWED_MIME)[number])) {
      throw new BusinessRuleError("Formato de imagem não aceito. Use JPG, PNG ou WebP.");
    }

    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new BusinessRuleError(
        "A imagem é grande demais mesmo após a compressão. Reduza o tamanho.",
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = EXTENSION_BY_MIME[file.type] ?? "bin";
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${extension}`;
    const absolutePath = path.join(uploadsDir(), storageKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);

    stored.push({
      storageKey,
      fileName: file.name || `imagem.${extension}`,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    });
  }

  return stored;
}

/** Remove arquivos já gravados (usado quando a transação falha depois do upload). */
export async function discardStoredImages(attachments: readonly AttachmentInput[]): Promise<void> {
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        await unlink(path.join(uploadsDir(), attachment.storageKey));
      } catch (error) {
        log.warn("falha ao remover anexo órfão", { storageKey: attachment.storageKey, error });
      }
    }),
  );
}

/** Cria as linhas de anexo dentro de uma transação existente. */
export async function createAttachmentRows(
  tx: Prisma.TransactionClient,
  input: {
    attachments: readonly AttachmentInput[];
    uploadedById: string;
    requestId?: string | null;
    maintenanceRequestId?: string | null;
  },
): Promise<void> {
  if (input.attachments.length === 0) return;

  await tx.attachment.createMany({
    data: input.attachments.map((attachment) => ({
      storageKey: attachment.storageKey,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      checksum: attachment.checksum ?? null,
      uploadedById: input.uploadedById,
      requestId: input.requestId ?? null,
      maintenanceRequestId: input.maintenanceRequestId ?? null,
    })),
  });
}

/** Metadados do anexo + referência à entidade pai, para checagem de acesso. */
export async function getAttachmentMetadata(attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      requestId: true,
      maintenanceRequestId: true,
    },
  });

  if (!attachment) throw new NotFoundError("Anexo");

  return attachment;
}

export function absolutePathFor(storageKey: string): string {
  return path.join(uploadsDir(), storageKey);
}
