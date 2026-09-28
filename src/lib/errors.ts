/**
 * Erros de domínio do almo-erp.
 *
 * Todo erro esperado da aplicação é uma subclasse de `AppError`, com uma
 * mensagem em português pronta para exibição. Erros que não são `AppError`
 * são bugs e devem aparecer como erro genérico na UI (sem vazar stack trace).
 */

export const APP_ERROR_CODES = [
  "FORBIDDEN",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "INVALID_TRANSITION",
  "INSUFFICIENT_STOCK",
  "BUSINESS_RULE",
  "NOT_IMPLEMENTED",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    userMessage: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(userMessage, { cause: options?.cause });
    this.name = new.target.name;
    this.code = code;
    this.userMessage = userMessage;
    this.details = options?.details;
  }
}

/** Usuário sem a permissão necessária. */
export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para executar esta ação.") {
    super("FORBIDDEN", message);
  }
}

/** Sem sessão válida (ou usuário suspenso). */
export class UnauthenticatedError extends AppError {
  constructor(message = "Sua sessão expirou. Entre novamente.") {
    super("UNAUTHENTICATED", message);
  }
}

/** Registro inexistente — ou fora do escopo de filial do usuário. */
export class NotFoundError extends AppError {
  constructor(resource = "Registro") {
    super("NOT_FOUND", `${resource} não encontrado.`);
  }
}

/** Dados inválidos que passaram pela tipagem mas violam uma regra. */
export class ValidationError extends AppError {
  constructor(message = "Dados inválidos.", details?: Record<string, unknown>) {
    super("VALIDATION", message, { details });
  }
}

/** Violação de unicidade ou de versão (lock otimista). */
export class ConflictError extends AppError {
  constructor(message = "O registro foi alterado por outro usuário. Recarregue a página.") {
    super("CONFLICT", message);
  }
}

/** Transição de status não permitida pela máquina de estados. */
export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string, entity = "Registro") {
    super("INVALID_TRANSITION", `Não é possível mudar ${entity} de "${from}" para "${to}".`, {
      details: { from, to },
    });
  }
}

/** Saldo insuficiente para a operação de estoque. */
export class InsufficientStockError extends AppError {
  constructor(itemLabel: string, requested: string, available: string) {
    super(
      "INSUFFICIENT_STOCK",
      `Saldo insuficiente para ${itemLabel}: solicitado ${requested}, disponível ${available}.`,
      { details: { itemLabel, requested, available } },
    );
  }
}

/** Regra de negócio genérica violada. */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("BUSINESS_RULE", message, { details });
  }
}

/** Recurso ainda não implementado nesta fase. */
export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super("NOT_IMPLEMENTED", `${feature} ainda não está disponível.`);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
