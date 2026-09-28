"use client";

import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener("change", onChange);

  return () => mediaQuery.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * No servidor não existe viewport: assumimos desktop para que o HTML
 * renderizado no servidor case com o primeiro render do cliente.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Detecta se a viewport está no breakpoint mobile.
 *
 * Implementado com `useSyncExternalStore` em vez de `useEffect` + `useState`
 * para não causar render em cascata nem divergência de hidratação.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
