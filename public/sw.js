/*
 * Service worker mínimo.
 *
 * Existe por um motivo específico: o Chrome só oferece "instalar na tela
 * inicial" quando a página registra um service worker com handler de `fetch`.
 * Sem ele, o resto do PWA (manifesto, ícones, standalone) não é suficiente.
 *
 * Deliberadamente **não** faz cache de resposta. Num ERP, servir saldo de
 * estoque velho do cache seria pior que mostrar a tela de sem conexão: o
 * almoxarife pode entregar material que não existe mais.
 */
const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sem conexão</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        padding: 1.5rem;
        background: #f8fafc;
        color: #0f172a;
        text-align: center;
      }
      div { max-width: 22rem; }
      h1 { font-size: 1.1rem; margin: 0 0 0.5rem; }
      p { color: #64748b; font-size: 0.875rem; margin: 0 0 1.25rem; line-height: 1.5; }
      button {
        border: 1px solid #cbd5e1;
        background: #fff;
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div>
      <h1>Sem conexão</h1>
      <p>
        O sistema precisa de internet para consultar o estoque. Verifique a rede e tente
        novamente — não mostramos dados salvos para evitar entregar material que já saiu.
      </p>
      <button onclick="location.reload()">Tentar novamente</button>
    </div>
  </body>
</html>`;

self.addEventListener("install", (event) => {
  // Assume o controle sem esperar a próxima navegação.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Só tratamos navegação; o resto passa direto para a rede.
  if (request.method !== "GET" || request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    ),
  );
});
