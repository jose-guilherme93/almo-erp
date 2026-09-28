import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

/**
 * Manifesto do PWA.
 *
 * Deixa o sistema instalável no celular do colaborador: ícone na tela inicial,
 * abre em tela cheia e sem a barra do navegador. Para um almoxarife que usa o
 * celular no balcão, é a diferença entre "abrir o site" e "abrir o app".
 *
 * `display: standalone` e `start_url: "/"` fazem o app abrir direto na tela
 * certa para o perfil de quem entrou (a raiz resolve a home).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // `maskable` permite o ícone recortado no formato do Android.
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Pedir material",
        short_name: "Material",
        url: "/solicitacoes/nova",
      },
      {
        name: "Abrir reparo",
        short_name: "Reparo",
        url: "/reparos/novo",
      },
      {
        name: "Minhas solicitações",
        short_name: "Meus pedidos",
        url: "/meu",
      },
    ],
  };
}
