import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { ServiceWorkerRegistrar } from "@/components/layout/service-worker-registrar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  // iOS não lê o manifest para o modo standalone: precisa destas meta tags.
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  other: {
    // O Next 16 emite a tag padronizada `mobile-web-app-capable`. iOS anterior
    // ao 16.4 só entende a legada — emitimos as duas para o app abrir em tela
    // cheia também em iPhone mais antigo.
    "apple-mobile-web-app-capable": "yes",
  },
  formatDetection: {
    // No celular, o navegador transformava código de material em link de
    // telefone. Não queremos isso em nenhuma tela.
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sem travar o zoom: o almoxarife às vezes precisa ampliar a tela.
  maximumScale: 5,
  themeColor: "#0f172a",
  // Em standalone a tela inteira é nossa, inclusive a área do notch.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
