"use client";

import { useEffect } from "react";

/**
 * Registra o service worker do PWA.
 *
 * Só em produção: em desenvolvimento o service worker atrapalha (fica servindo
 * resposta antiga enquanto o código muda) e não agrega nada.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Falhar aqui não pode quebrar a aplicação: o sistema funciona
        // normalmente no navegador, só não fica instalável.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
