"use client";

import { useState } from "react";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DRIVE_FILE_SCOPE,
  DRIVE_UPLOAD_URL,
  buildDriveUploadFormData,
  driveCsvFileName,
  type DriveFile,
} from "@/lib/drive";
import { registrarExportacaoDriveAction } from "@/server/actions/relatorio";

/**
 * "Enviar ao Google Drive".
 *
 * O usuário já está logado com a conta corporativa (Workspace). O acesso ao
 * Drive é pedido na hora, no navegador (Google Identity Services), com o escopo
 * mínimo `drive.file`: o app só enxerga os arquivos que ele mesmo cria. Nenhum
 * token fica guardado no servidor — ele apenas registra a exportação.
 */

type TokenResponse = { access_token?: string };

type TokenClient = { requestAccessToken: () => void };

type GoogleOAuth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (response: TokenResponse) => void;
    error_callback?: () => void;
  }) => TokenClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const selector = 'script[data-gis="1"]';
    const existing = document.querySelector<HTMLScriptElement>(selector);

    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar o Google.")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset["gis"] = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar o Google."));
    document.head.appendChild(script);
  });
}

async function requestDriveToken(clientId: string): Promise<string> {
  await loadGoogleIdentityServices();

  const oauth2 = window.google?.accounts?.oauth2;

  if (!oauth2) throw new Error("Serviço do Google indisponível.");

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      prompt: "",
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error("Autorização do Drive recusada."));
      },
      error_callback: () => reject(new Error("Autorização do Drive recusada.")),
    });

    client.requestAccessToken();
  });
}

export function DriveExportButton({
  snapshotId,
  reportId,
  from,
  to,
  csvHref,
  clientId,
}: {
  snapshotId: string;
  reportId: string;
  from: string;
  to: string;
  csvHref: string;
  clientId: string | null;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!clientId) {
      toast.error(
        "Google Drive não está configurado neste ambiente. Peça ao administrador para habilitar a Drive API e o escopo drive.file.",
      );
      return;
    }

    setLoading(true);

    try {
      const token = await requestDriveToken(clientId);

      // O CSV do snapshot congelado: `auditar=0` evita registrar uma descarga
      // intermediária — quem registra a exportação é o envio ao Drive.
      const response = await fetch(`${csvHref}?auditar=0`, { credentials: "same-origin" });

      if (!response.ok) throw new Error("Não foi possível ler o CSV do relatório.");

      const csv = await response.text();
      const fileName = driveCsvFileName({ report: reportId, from, to });
      const form = buildDriveUploadFormData(fileName, csv);

      const upload = await fetch(DRIVE_UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!upload.ok) throw new Error("O Google recusou o envio do arquivo.");

      const file = (await upload.json()) as DriveFile;

      const registered = await registrarExportacaoDriveAction({
        snapshotId,
        fileId: file.id,
        fileName: file.name ?? fileName,
        url: file.webViewLink ?? null,
      });

      if (!registered.ok) throw new Error(registered.error);

      toast.success("Relatório enviado ao seu Google Drive.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar ao Drive.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={loading || !clientId}>
      <CloudUpload className="size-4" />
      {loading ? "Enviando…" : "Enviar ao Google Drive"}
    </Button>
  );
}
