import "./sentry.client.config";

/**
 * Inicialização do observabilidade no navegador.
 *
 * O Next carrega este arquivo uma vez, no cliente, antes de hidratar a página.
 * É o gancho da instrumentação do servidor espelhado para cá: enquanto o
 * `instrumentation.ts` vê o que quebra no servidor, este vê o que quebra no
 * navegador — tela branca, erro de hidratação, evento que quebra sem origem.
 *
 * A configuração vive em `sentry.client.config.ts` porque é um módulo com
 * efeito colateral (chama `init`), e o Next exige que este arquivo apenas o
 * importe.
 *
 * Nada aqui escreve no banco: o que vem do navegador é entrada não confiável.
 * O relatório sai direto para o destino externo, depois de `beforeSend`.
 */
export {};
