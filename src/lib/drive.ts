import { csvFileName } from "@/lib/csv";

/**
 * Exportação para o Google Drive.
 *
 * Usa o escopo mais restrito possível — `drive.file` dá acesso **apenas** aos
 * arquivos que este aplicativo cria, nunca ao Drive inteiro do usuário. O token
 * é obtido no navegador (Google Identity Services) e não fica guardado no
 * servidor; o servidor só registra a exportação na trilha de auditoria.
 *
 * Pré-requisito (Google Cloud Console): habilitar a Drive API e adicionar o
 * escopo `drive.file` à tela de consentimento OAuth. Sem isso, o botão fica
 * desabilitado (ver `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";

export type DriveFile = {
  id: string;
  name: string;
  webViewLink?: string;
};

/** Nome do arquivo no Drive: reutiliza o mesmo padrão do download local. */
export function driveCsvFileName(parts: {
  report: string;
  from?: string | null;
  to?: string | null;
}): string {
  return csvFileName(parts);
}

/**
 * Corpo multipart que a Drive API espera (`metadata` + `file`).
 *
 * Em Node e no navegador, `FormData`/`Blob` são globais — dá para montar e
 * testar a mesma função nos dois lados.
 */
export function buildDriveUploadFormData(name: string, csv: string): FormData {
  const form = new FormData();

  form.append(
    "metadata",
    new Blob([JSON.stringify({ name, mimeType: "text/csv" })], { type: "application/json" }),
  );
  form.append("file", new Blob([csv], { type: "text/csv;charset=utf-8" }), name);

  return form;
}
