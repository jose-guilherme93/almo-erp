import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { notify } from "@/server/services/notification";

const log = logger.with({ service: "error-alert" });

/**
 * Alerta de erro novo, uma vez por erro.
 *
 * Fica em arquivo próprio porque `instrumentation.ts` importa isto por
 * `import()` dinâmico — o service de erro, que fala com o Prisma, não pode ser
 * carregado no topo do arquivo de instrumentação (o runtime edge não tem
 * Prisma).
 *
 * A notificação é enviada **só na criação** da linha. Um erro que se repete 500
 * vezes continuaria sendo um erro só; notificar cada vez transformaria o sino
 * em ruído e esconderia justamente o problema mais grave.
 */
export async function reportNewError(errorLogId: string): Promise<void> {
  try {
    const errorLog = await prisma.errorLog.findUnique({
      where: { id: errorLogId },
      select: { id: true, message: true, routePath: true, digest: true, count: true },
    });

    if (!errorLog) return;

    // O link aponta pela **referência** que a tela documenta (o digest que o
    // usuário viu). Sem digest, cai no id — que a busca também passou a aceitar.
    const reference = errorLog.digest ?? errorLog.id;

    // `prisma` como "transação": o erro já está gravado, e não existe uma
    // transação de negócio a amarrar. O que importa é que uma falha aqui não
    // propague — o `catch` abaixo engole.
    await notify(prisma, {
      type: "ERROR_REPORTED",
      // Sistema, não pessoa: `actorId` nulo para não excluir ninguém da lista.
      actorId: null,
      branchId: null,
      entityType: "ErrorLog",
      entityId: errorLog.id,
      link: `/admin/erros?busca=${reference}`,
      data: {
        message: errorLog.message,
        routePath: errorLog.routePath,
        count: String(errorLog.count),
        digest: errorLog.digest,
      },
    });

    log.info("erro novo notificado", { routePath: errorLog.routePath, errorLogId });
  } catch (error) {
    // Notificação é best-effort: o erro já está gravado e visível em
    // `/admin/erros`. Falhar aqui apenas significa que o sino não apitou.
    log.error("falha ao notificar erro novo", { error });
  }
}
