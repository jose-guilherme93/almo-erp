/**
 * Ruído que o Next emite e **não** é defeito da aplicação.
 *
 * Mora em módulo próprio, sem dependência nenhuma, porque é consultado de dois
 * runtimes: da instrumentação (que também roda na edge) e do gravador no banco.
 * Duas cópias dessa lista seriam duas listas que divergem — e a divergência
 * apareceria como um filtro largo demais ou curto demais, que é o oposto do que
 * a tela de erros precisa.
 *
 * "The destination stream closed early." acontece quando uma navegação RSC é
 * abandonada — o usuário clica em outro link, ou a aba é fechada, antes do
 * stream terminar. É o comportamento normal de uma navegação cancelada, e chega
 * em volume alto. Sem este filtro a tela vira parede de ruído e o erro que
 * importa some no meio.
 *
 * A lista é curta e específica de propósito: um filtro largo esconderia erro de
 * verdade.
 */
const IGNORABLE_ERROR = [
  /destination stream closed early/i,
  /^the operation was aborted/i,
  /^request aborted/i,
  /^aborted\b/i,
  /ERR_ABORTED/i,
  /navigation.*aborted/i,
];

/** `true` quando o erro é cancelamento de navegação, e não defeito. */
export function isIgnorableError(message: string): boolean {
  return IGNORABLE_ERROR.some((pattern) => pattern.test(message));
}
