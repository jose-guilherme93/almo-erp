import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.with({ service: "telegram" });

/**
 * Alerta de incidente no Telegram.
 *
 * Existe porque o plano gratuito do Better Stack **não** integra Telegram: o
 * alerta sai do plano pago. Como este projeto roda numa VPS de 2 vCPU e não pode
 * pagar, o aviso é nosso — e sair de graça também é o Telegram.
 *
 * Duas regras valem aqui mais do que em qualquer outro envio:
 *
 * 1. **Nunca lança.** Um alerta que derruba a requisição que já estava falhando
 *    troca um erro visível por dois invisíveis.
 * 2. **Nunca vaza.** A mensagem vai para um chat, onde é lida em pé, no celular.
 *    Por isso ela não leva o corpo do erro: só a origem, o código e o resumo
 *    já tratado. O detalhe fica em `/admin/erros`, atrás de login.
 */

const TELEGRAM_TIMEOUT_MS = 5_000;

/** Quanto o mesmo erro pode alertar, em minutos. */
const THROTTLE_MINUTES = 15;

type ThrottleEntry = { lastSentAt: number };

/**
 * Freio por incidente.
 *
 * O `ErrorLog` já agrupa por fingerprint e só notifica o primeiro registro, mas
 * o Telegram é outro canal: um erro que se repete em laço (retry, worker
 * gidrando, rota em loop) não pode virar 500 mensagens no mesmo chat em cinco
 * minutos. O freio é por rota+mensagem, que é a unidade que o humano reconhece.
 */
const throttle = new Map<string, ThrottleEntry>();

export type AlertPayload = {
  /** Texto curto do que aconteceu, já sem dado pessoal. */
  summary: string;
  /** Onde olhar. */
  routePath?: string | null;
  /** Código que correlaciona com a tela do usuário. */
  digest?: string | null;
  /** Volume acumulado do mesmo erro, quando conhecido. */
  count?: number | null;
};

/**
 * Envia o alerta. Silencioso quando não há configuração ou quando o mesmo
 * incidente já alertou há pouco.
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = getEnv();

  // Sem token não há o que fazer, e isso não é erro: dev, CI e preview rodam
  // sem Telegram, e o sistema precisa funcionar igual.
  if (!token || !chatId) return;

  if (isThrottled(payload)) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatMessage(payload),
        // Uma falha de entrega não pode virar outra falha de entrega, em laço.
        disable_notification: false,
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Não marca como enviado: se a rede falhou, o próximo erro real alerta.
      log.warn("telegram recusou o alerta", { status: response.status });
      return;
    }

    markSent(payload);
    log.info("alerta enviado", { routePath: payload.routePath });
  } catch (error) {
    log.warn("falha ao enviar alerta", { error });
  }
}

/** Teste: limpa o freio para não vazar estado entre casos. */
export function resetAlertThrottle(): void {
  throttle.clear();
}

/**
 * Condensa a mensagem do erro em uma linha curta.
 *
 * A mensagem que o Next entrega carrega o prefixo da exceção e às vezes um
 * caminho de arquivo. No Telegram isso vira um bloco de texto que empurra a
 * informação útil para baixo da dobra — e a linha inteira é onde o resumo
 * importa.
 */
export function shortSummary(message: string, limit = 160): string {
  const firstLine = message.split("\n")[0]?.trim() ?? "";

  if (firstLine.length <= limit) return firstLine;

  return `${firstLine.slice(0, limit)}…`;
}

/** O mesmo incidente dentro da janela não alerta de novo. */
export function isThrottled(payload: AlertPayload): boolean {
  const entry = throttle.get(throttleKey(payload));

  if (!entry) return false;

  return Date.now() - entry.lastSentAt < THROTTLE_MINUTES * 60_000;
}

function markSent(payload: AlertPayload): void {
  throttle.set(throttleKey(payload), { lastSentAt: Date.now() });
}

/** Rota + resumo: o que o humano reconhece como "o mesmo erro". */
function throttleKey(payload: AlertPayload): string {
  return `${payload.routePath ?? "-"}|${payload.summary}`;
}

/**
 * Corpo da mensagem.
 *
 * Mantido em texto simples de propósito: renderizar Markdown exige escapar cada
 * caractere, e um alerta mal formatado é pior do que um alerta cru. O link vai
 * como texto porque o Telegram só torna clicável o que é URL de fato.
 */
export function formatMessage(payload: AlertPayload): string {
  const lines = ["almo-erp: erro de servidor", payload.summary];

  if (payload.routePath) lines.push(`Rota: ${payload.routePath}`);
  if (payload.digest) lines.push(`Digest: ${payload.digest}`);
  if (payload.count && payload.count > 1) lines.push(`Ocorrências: ${payload.count}`);

  lines.push("Detalhes em /admin/erros");

  return lines.join("\n");
}
