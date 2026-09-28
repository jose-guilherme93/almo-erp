/**
 * Regra de acesso por e-mail corporativo.
 *
 * Funções PURAS e testáveis — nenhuma consulta ao banco aqui. Quem lê o
 * banco é o `authorize()` em `@/lib/auth.ts`, que usa estas funções para
 * decidir. Assim a regra mais sensível do sistema fica coberta por testes
 * sem precisar de banco.
 *
 * A regra tem duas camadas (docs/ARQUITETURA.md §4):
 *   1. o domínio precisa ser corporativo
 *   2. o e-mail precisa estar pré-aprovado (usuário ACTIVE no banco)
 *
 * Este arquivo cuida da camada 1 e do padrão opcional por e-mail.
 */

/** Uma política como ela vem do banco, reduzida ao que a regra precisa. */
export type EmailPolicyRule = {
  domain: string;
  pattern: string | null;
  autoApprove: boolean;
  active: boolean;
};

export type EmailEvaluation =
  | { allowed: true; matchedPolicy: EmailPolicyRule | null }
  | { allowed: false; reason: EmailDenyReason };

export type EmailDenyReason = "invalid-shape" | "domain-not-allowed" | "pattern-mismatch";

/** `"  Foo@Exemplo.COM.BR "` → `"foo@exemplo.com.br"` */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailShape(email: string): boolean {
  return EMAIL_SHAPE.test(email);
}

/**
 * Extrai o domínio de um e-mail já normalizado.
 * Devolve `null` se o formato for inválido ou não houver domínio.
 */
export function extractDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!isValidEmailShape(normalized)) return null;

  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return domain.length > 0 ? domain : null;
}

/**
 * O domínio é corporativo?
 *
 * Vale a união de duas fontes: a lista do ambiente (`AUTH_ALLOWED_DOMAINS`)
 * e as `EmailPolicy` ativas do banco. A união é intencional — permite ligar
 * um domínio por deploy sem tocar no banco, ou pelo banco sem deploy.
 */
export function isCorporateDomain(
  domain: string,
  environmentDomains: readonly string[],
  policies: readonly EmailPolicyRule[],
): boolean {
  const target = domain.trim().toLowerCase();

  const inEnvironment = environmentDomains.some(
    (allowed) => allowed.trim().toLowerCase() === target,
  );

  if (inEnvironment) return true;

  return policies.some((policy) => policy.active && policy.domain.toLowerCase() === target);
}

/**
 * Aplica o `pattern` (regex) da política ao e-mail.
 *
 * Sem pattern, qualquer e-mail do domínio passa. Pattern inválida é tratada
 * como "não casa" — nunca deixar uma regex quebrada liberar acesso.
 */
export function matchesEmailPattern(email: string, pattern: string | null): boolean {
  if (!pattern) return true;

  try {
    return new RegExp(pattern).test(normalizeEmail(email));
  } catch {
    return false;
  }
}

/** Valida se uma regex de política é utilizável — usado na tela de políticas. */
export function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Avalia a camada 1 completa (domínio + pattern) e devolve a política que
 * autorizou, para o `authorize()` decidir o que fazer com `autoApprove`.
 */
export function evaluateCorporateEmail(
  rawEmail: string,
  environmentDomains: readonly string[],
  policies: readonly EmailPolicyRule[],
): EmailEvaluation {
  const email = normalizeEmail(rawEmail);

  if (!isValidEmailShape(email)) {
    return { allowed: false, reason: "invalid-shape" };
  }

  const domain = extractDomain(email);
  if (!domain) {
    return { allowed: false, reason: "invalid-shape" };
  }

  if (!isCorporateDomain(domain, environmentDomains, policies)) {
    return { allowed: false, reason: "domain-not-allowed" };
  }

  const activePolicies = policies.filter(
    (policy) => policy.active && policy.domain.toLowerCase() === domain,
  );

  const matched = activePolicies.find((policy) => matchesEmailPattern(email, policy.pattern));

  if (!matched) {
    // Só chega aqui se havia política com pattern e nenhuma casou.
    const hasPattern = activePolicies.some((policy) => policy.pattern !== null);

    return hasPattern
      ? { allowed: false, reason: "pattern-mismatch" }
      : { allowed: true, matchedPolicy: null };
  }

  return { allowed: true, matchedPolicy: matched };
}

/** Mensagem em pt-BR para cada motivo de negativa — usada em `/acesso-negado`. */
export const DENY_REASON_MESSAGES: Record<EmailDenyReason, string> = {
  "invalid-shape": "O e-mail informado não é um endereço válido.",
  "domain-not-allowed":
    "Este e-mail não é de um domínio corporativo autorizado. Use seu e-mail da empresa.",
  "pattern-mismatch":
    "Este e-mail não atende à regra de acesso configurada para o domínio. Fale com o administrador.",
};

/** Motivos de negativa que vêm da camada de usuário (banco), não do e-mail. */
export type AccessDenyReason =
  | EmailDenyReason
  | "awaiting-approval"
  | "pending-approval"
  | "suspended"
  | "user-inactive"
  | "access-denied";

export const ACCESS_DENY_MESSAGES: Record<AccessDenyReason, string> = {
  ...DENY_REASON_MESSAGES,
  "awaiting-approval": "Seu acesso foi registrado e aguarda aprovação de um administrador.",
  "pending-approval": "Seu acesso ainda não foi aprovado por um administrador.",
  suspended: "Seu acesso está suspenso. Fale com o administrador.",
  "user-inactive": "Sua conta está inativa. Fale com o administrador.",
  "access-denied": "Não foi possível autenticar. Tente novamente.",
};

export function isAccessDenyReason(value: string): value is AccessDenyReason {
  return value in ACCESS_DENY_MESSAGES;
}
