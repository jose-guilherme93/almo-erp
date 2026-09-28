"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { ActionResult } from "@/lib/action-result";
import { formatRelative } from "@/lib/format";
import { marcarTodasNotificacoesLidasAction } from "@/server/actions/notificacao";

export type BellNotification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
};

/**
 * Sino de notificações.
 *
 * O contador vem do servidor (`unreadCount`) e é o mesmo número usado no
 * dashboard — não há recálculo paralelo que possa divergir.
 */
export function NotificationBell({
  unread,
  latest,
}: {
  unread: number;
  latest: BellNotification[];
}) {
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ count: number }> | null,
    FormData
  >(marcarTodasNotificacoesLidasAction, null);

  useEffect(() => {
    if (!state) return;

    if (state.ok) toast.success(state.message ?? "Notificações marcadas como lidas.");
    else toast.error(state.error);
  }, [state]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notificações: ${unread} não lidas` : "Notificações"}
        >
          <Bell className="size-5" />
          {unread > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-medium">Notificações</p>
          {unread > 0 ? (
            <form action={formAction}>
              <Button type="submit" variant="ghost" size="sm" disabled={isPending}>
                Marcar todas como lidas
              </Button>
            </form>
          ) : null}
        </div>

        <Separator />

        {latest.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            Nenhuma notificação nova.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {latest.map((notification) => (
              <li key={notification.id}>
                <Link
                  href={notification.link ?? "/notificacoes"}
                  className="hover:bg-accent block px-3 py-2.5"
                >
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                    {notification.body}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    {formatRelative(notification.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Separator />

        <div className="p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/notificacoes">Ver todas</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
