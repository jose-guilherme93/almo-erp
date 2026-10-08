import { headers } from "next/headers";

import { isAppError } from "@/lib/errors";
import {
  actionFailureFromError,
  isNextControlFlowError,
  type ActionResult,
} from "@/lib/action-result";
import { dispatchIncident } from "@/server/services/observability";

/**
 * Envolve o corpo de uma Server Action, capturando erros de domínio.
 *
 * ## Por que isto mora em `server/actions` e não em `lib`
 *
 * Uma Server Action **não propaga** exceção: quem a chama é um componente
 * cliente, e o que ele recebe é um `{ ok: false }`. Isso é bom para a tela, e é
 * exatamente o que torna a falha invisível para quem opera — o `onRequestError`
 * só enxerga o erro que chegou a ser lançado na requisição, e aqui ele foi
 * engolido antes disso.
 *
 * `lib` não pode importar `server/` (AGENTS.md §4, e o ESLint barra), então o
 * relato do erro não cabia em `lib/action-result.ts`. Movendo `runAction` para
 * cá, a captação passa a conhecer o funil **sem** que nenhum dos ~105 call sites
 * mude: só a linha de import de cada arquivo.
 *
 * Erro de domínio (`AppError`) é falha prevista e vira a mensagem que o usuário
 * lê — não é incidente. Só o erro inesperado vira incidente, porque é o único
 * que ninguém esperava e o único que interessa a quem responde.
 */
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    // `redirect()` precisa escapar: convertê-lo em ActionResult quebraria a
    // navegação (o Next depende do throw para efetivar o redirect).
    if (isNextControlFlowError(error)) {
      throw error;
    }

    // `AppError` é falha **prevista**: "justificativa obrigatória", "saldo
    // insuficiente", "sem permissão". A tela já mostra a mensagem ao usuário, e o
    // resultado é o mesmo se acontecer mil vezes — não é defeito, é o produto
    // recusando uma operação. Reportá-lo faria o `ErrorLog` e o Telegram
    // encherem de erro de digitação, e o defeito real se esconderia no meio.
    //
    // Isso só apareceu rodando: o banco registrou "A justificativa do ajuste é
    // obrigatória" como se fosse incidente.
    //
    // `NOT_IMPLEMENTED` é a exceção: ali o produto está incompleto, e quem
    // clica precisa saber. Vira incidente, com a prioridade que merece.
    if (!isAppError(error) || error.code === "NOT_IMPLEMENTED") {
      // O relato não pode atrasar a resposta: quem está no balcão não espera a
      // rede para ver a mensagem. `dispatchIncident` nunca lança, então o erro
      // reportado não tem como virar um erro novo.
      void dispatchIncident({
        kind: "action",
        routePath: await currentRoutePath(),
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        context: { error },
      });
    }

    return actionFailureFromError(error);
  }
}

/** Cabeçalhos que carregam a rota, na ordem em que valem. */
const ROUTE_HEADERS = ["next-url", "x-pathname", "referer"] as const;

const UNKNOWN_ROUTE = "(server action)";

/**
 * Tela em que a action está sendo executada.
 *
 * Não é a action: duas actions do mesmo arquivo respondem a formulários
 * diferentes, e o que diagnostica é a tela.
 *
 * Só o `next-url` não resolvia: ele é enviado na **navegação RSC**, e a maioria
 * das actions chega por POST de formulário — que não traz o cabeçalho. O
 * resultado era toda incidente de action com rota `(server action)`, o que
 * invibilizava filtrar por tela em `/admin/erros`. Por isso a lista de cabeçalhos,
 * com `referer` no fim: é o que o navegador envia de fato num POST, e apontar
 * para a página de onde o formulário veio é a informação que serve.
 *
 * A query string é descartada aqui e não depois: `referer` traz a URL inteira, e
 * em tela com filtro ela carrega nome de pessoa e CPF.
 *
 * Fora de uma requisição (job, script, CLI) não há cabeçalho — e o Next lança ao
 * chamá-lo nesse contexto. O incidente fica sem rota, que é honesto: melhor um
 * erro sem rota do que uma rota inventada.
 */
async function currentRoutePath(): Promise<string> {
  try {
    const requestHeaders = await headers();

    for (const name of ROUTE_HEADERS) {
      const value = requestHeaders.get(name);
      const path = toPath(value);

      if (path) return path;
    }
  } catch {
    // Sem requisição não há rota. Segue para o marcador.
  }

  return UNKNOWN_ROUTE;
}

/** Extrai o caminho de uma URL ou caminho, sem query string. */
function toPath(value: string | null): string | null {
  if (!value) return null;

  // `referer` é URL absoluta; `next-url` já vem como caminho.
  const path = value.startsWith("http") ? safePathname(value) : value.split("?")[0];

  if (!path || !path.startsWith("/")) return null;

  // Remove a origem se sobrou: `https://site.com/x` → `/x`.
  const withoutOrigin = path.replace(/^https?:\/\/[^/]+/, "");

  return withoutOrigin === "" ? null : withoutOrigin;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
