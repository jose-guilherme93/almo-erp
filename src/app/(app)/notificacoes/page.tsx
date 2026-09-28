import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CheckCheck } from "lucide-react";

import { NotificationItem } from "@/components/domain/notification-item";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { firstParam } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listNotifications } from "@/server/services/notification/inbox";

export const metadata: Metadata = {
  title: "Notificações",
};

export default async function NotificacoesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("notificacao:read");

  const onlyUnread = firstParam(params, "naoLidas") !== "0";

  const result = await listNotifications(context.user.id, {
    onlyUnread,
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="Notificações"
        description="Avisos do que precisa da sua atenção: pedidos, transferências e alertas de estoque."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={onlyUnread ? "/notificacoes?naoLidas=0" : "/notificacoes"}
          className="border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
        >
          {onlyUnread ? "Ver todas" : "Ver somente não lidas"}
        </Link>

        {result.unread > 0 ? (
          <p className="text-muted-foreground text-sm">
            {result.unread} não lida(s) de {result.total}
          </p>
        ) : null}
      </div>

      {result.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellOff className="size-5" aria-hidden />
              Nada por aqui
            </CardTitle>
            <CardDescription>
              {onlyUnread
                ? "Você já leu todas as notificações."
                : "Nenhuma notificação recebida até agora."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-2">
          {result.items.map((notification) => (
            <li key={notification.id}>
              <NotificationItem
                id={notification.id}
                title={notification.title}
                body={notification.body}
                link={notification.link}
                read={notification.readAt !== null}
                createdAt={formatDateTime(notification.createdAt)}
                branchName={notification.branch?.name ?? null}
                actorName={notification.actor?.name ?? null}
              />
            </li>
          ))}
        </ul>
      )}

      {result.total > result.pageSize ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <CheckCheck className="size-4" aria-hidden />
          Mostrando {result.items.length} de {result.total}. Use os filtros para refinar.
        </p>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-xs">
            Ao abrir uma notificação, ela é marcada como lida automaticamente. Você também pode usar{" "}
            <Button asChild variant="link" className="h-auto p-0 text-xs">
              <Link href="/admin/politicas-email">as políticas de acesso</Link>
            </Button>{" "}
            para ajustar quem é avisado.
          </p>
        </CardContent>
      </Card>
    </PageBody>
  );
}
