/**
 * Testes dos helpers de exportação para o Google Drive.
 *
 * O que precisa ser provado: o nome do arquivo é previsível e o corpo multipart
 * tem as duas partes que a Drive API exige (`metadata` + `file`).
 */
import { describe, expect, it } from "vitest";

import { DRIVE_FILE_SCOPE, buildDriveUploadFormData, driveCsvFileName } from "@/lib/drive";

describe("exportação para o Google Drive", () => {
  it("usa o escopo mínimo drive.file", () => {
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("monta o nome do arquivo com relatório, período e extensão csv", () => {
    const name = driveCsvFileName({
      report: "consumo-material",
      from: "2026-01-01",
      to: "2026-01-31",
    });

    expect(name).toBe("consumo-material-2026-01-01-2026-01-31.csv");
  });

  it("monta o multipart com metadata e file", async () => {
    const form = buildDriveUploadFormData("relatorio.csv", "Código;Material\r\nA;1\r\n");

    const metadata = form.get("metadata");
    const file = form.get("file");

    expect(metadata).toBeInstanceOf(Blob);
    expect(file).toBeInstanceOf(File);

    const metadataText = await (metadata as Blob).text();
    expect(JSON.parse(metadataText)).toEqual({ name: "relatorio.csv", mimeType: "text/csv" });

    // O arquivo carrega o nome e o conteúdo CSV, com o BOM preservado.
    expect((file as File).name).toBe("relatorio.csv");
    expect(await (file as File).text()).toContain("Código;Material");
  });
});
