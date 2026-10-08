/**
 * Remoção de dado pessoal antes de qualquer envio para fora.
 *
 * Payload de erro carrega o que deu errado **e o contexto em que deu errado** —
 * e esse contexto, num ERP escolar, é cheio de nome, e-mail, CPF, CNPJ e
 * endereço. Sem esta etapa, o que sai da VPS é um relatório de erro com dado
 * pessoal de aluno, professor ou fornecedor. Para um sistema em produção isso é
 * problema de LGPD, não de hygiene.
 *
 * A régua é propositalmente **larga demais** e **curta**: preferimos perder um
 * campo útil a deixar vazar um CPF. Além da lista, some com a query string da
 * URL (que em relatório carrega filtro de pessoa) e com o corpo da requisição.
 */

/** Campos cujo **nome** denuncia credencial. some o valor, não a chave. */
const SECRET_KEY =
  /(senha|password|passwd|pwd|token|secret|api[-_]?key|authorization|cookie|session|credential|signature|private[-_]?key)/i;

/** Campos cujo **nome** denuncia dado pessoal de terceiro. */
const PERSONAL_KEY =
  /^(cpf|cnpj|rg|email|e-?mail|mail|phone|telefone|celular|whatsapp|endereco|address|nome|name|fullname|user(name)?|login|birth(nasc|day)?|nascimento|doc(umento)?)$/i;

/** Padrões que denunciam o valor mesmo quando o nome do campo é inocente. */
const SECRET_VALUE = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\beyJ[A-Za-z0-9._-]{20,}\b/g, // JWT
  /\b[A-Fa-f0-9]{32,}\b/g, // hex longo: token, hash, id de sessão
  /:\/\/([^:@\s/]+):([^@:\s/]+)@/g, // credencial em URL

  // Documento e contato em texto solto.
  //
  // Estes três não são segredo — são dado pessoal, e num ERP escolar a diferença
  // é a mesma na prática: um CPF num relatório de erro identifica aluno,
  // professor ou fornecedor. Aparece em mensagem de falha no formato
  // "não foi possível validar 123.456.789-00", e um filtro que só olhasse o
  // *nome* do campo não veria nada, porque aqui não há campo: é o valor.
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, // CPF formatado
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, // CNPJ formatado
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // e-mail
];

export const REDACTED_PLACEHOLDER = "[omitido]";

/**
 * Marca no lugar da linha removida.
 *
 * A linha é omitida, e não apagada em silêncio: saber que havia uma segunda
 * linha — e que ela foi removida — faz parte do diagnóstico, e o sumiço
 * silencioso se confunde com "o erro veio em uma linha só".
 */
export const REDACTED_LINE = "[linha omitida: pode conter dado sensível]";

/** Valor de cabeçalho que nunca deve sair. */
const FORBIDDEN_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-csrf-token",
  "x-auth-token",
  "proxy-authorization",
]);

/** Aplica os padrões de valor sobre um texto solto. */
export function scrubText(value: string): string {
  let result = value;

  for (const pattern of SECRET_VALUE) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), REDACTED_PLACEHOLDER);
  }

  return result;
}

/** Decide o que fazer com um par chave/valor. */
function scrubEntry(key: string, value: unknown, depth: number): unknown {
  // Profundidade limitada: payload malformado não pode virar recursão infinita.
  if (depth > 6) return "[omitido: muito aninhado]";

  if (SECRET_KEY.test(key)) return REDACTED_PLACEHOLDER;
  if (PERSONAL_KEY.test(key)) return REDACTED_PLACEHOLDER;

  if (typeof value === "string") return scrubText(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => scrubEntry(key, item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    return scrubObject(value as Record<string, unknown>, depth + 1);
  }

  // number/boolean/null passam intactos: são o contexto que faz o erro ser
  // diagnosticável, e não identificam ninguém.
  return value;
}

/** Percorre um objeto aplicando a régua em toda chave. */
export function scrubObject(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    result[key] = scrubEntry(key, value, depth);
  }

  return result;
}

/** Mensagem e stack: substitui a linha inteira quando ela parece sensível. */
export function scrubMessage(text: string, limit = 2_000): string {
  const lines = text.split("\n").slice(0, 60);

  const kept = lines.map((line) => {
    if (SECRET_KEY.test(line)) return REDACTED_LINE;

    return SECRET_VALUE.reduce(
      (acc, pattern) =>
        acc.replace(new RegExp(pattern.source, pattern.flags), REDACTED_PLACEHOLDER),
      line,
    );
  });

  const clipped = kept.join("\n");

  return clipped.length <= limit ? clipped : `${clipped.slice(0, limit)}…`;
}

/**
 * Caminho da requisição sem query string.
 *
 * Em tela de relatório e busca, a query carrega nome de pessoa, CPF e filtro de
 * filial. O caminho (`/relatorios`) basta para diagnosticar; a query vaza.
 */
export function scrubPath(path: string): string {
  const [routePath = ""] = path.split("?");

  return routePath;
}

/** Cabeçalhos de requisição, mantendo só os inofensivos e banindo os cookies. */
export function scrubHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();

    if (FORBIDDEN_HEADERS.has(lower)) continue;
    if (SECRET_KEY.test(lower)) continue;
    if (value === undefined) continue;

    result[lower] = Array.isArray(value) ? scrubText(value.join(", ")) : scrubText(value);
  }

  return result;
}
