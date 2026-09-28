/**
 * Logger estruturado.
 *
 * Substitui `console.log` (proibido em código de produção pelo AGENTS.md §5).
 * Em desenvolvimento sai legível; em produção sai JSON de uma linha, pronto
 * para ser coletado por observabilidade.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: LogLevel =
  process.env.NODE_ENV === "production"
    ? "info"
    : process.env.NODE_ENV === "test"
      ? "warn"
      : "debug";

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }

  return error;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;

  const payload: LogContext = {
    level,
    time: new Date().toISOString(),
    message,
    ...context,
  };

  if (payload["error"] !== undefined) {
    payload["error"] = serializeError(payload["error"]);
  }

  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(payload)
      : `[${level.toUpperCase()}] ${message}`;

  const sink = level === "error" || level === "warn" ? console.error : console.log;

  if (process.env.NODE_ENV === "production") {
    sink(line);
  } else {
    sink(line, context ?? "");
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),

  /** Logger com contexto fixo, útil por serviço (ex.: `logger.with({ service: "estoque" })`). */
  with(baseContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        emit("debug", message, { ...baseContext, ...context }),
      info: (message: string, context?: LogContext) =>
        emit("info", message, { ...baseContext, ...context }),
      warn: (message: string, context?: LogContext) =>
        emit("warn", message, { ...baseContext, ...context }),
      error: (message: string, context?: LogContext) =>
        emit("error", message, { ...baseContext, ...context }),
    };
  },
};
