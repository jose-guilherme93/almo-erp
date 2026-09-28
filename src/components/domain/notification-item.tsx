"use client";

import { Mail, MailOpen } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ActionResult } from "@/lib/action-result";
import { marcarNotificacaoLidaAction } from "@/server/actions/notificacao";
import { cn } from "@/lib/utils";

/**
 * Item da caixa de entrada.
 *
 * Abrir a notificação marca como lida — é o gesto que o usuário espera. O
 * botão explícito existe para quem quer limpar a lista sem navegar.
 */
export function NotificationItem({
  id,
  title,
  body,
  link,
  read,
  createdAt,
  branchName,
  actorName,
}: {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  branchName: string | null;
  actorName: string | null;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult<undefined> | null, FormData>(
    marcarNotificacaoLidaAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  return (
    <Card className={cn(!read && "border-primary/40 bg-accent/30")}>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {!read ? <Badge variant="default">nova</Badge> : null}
            <p className="font-medium">{title}</p>
          </div>

          <p className="text-muted-foreground text-sm">{body}</p>

          <p className="text-muted-foreground text-xs">
            {createdAt}
            {branchName ? ` · ${branchName}` : ""}
            {actorName ? ` · por ${actorName}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 gap-1">
          {link ? (
            <form action={formAction}>
              <input type="hidden" name="notificationId" value={id} />
              <Button type="submit" variant="outline" size="sm" disabled={isPending}>
                <MailOpen className="size-4" />
                Abrir
              </Button>
            </form>
          ) : null}

          {!read ? (
            <form action={formAction}>
              <input type="hidden" name="notificationId" value={id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={isPending}
                aria-label={`Marcar "${title}" como lida`}
              >
                <Mail className="size-4" />
              </Button>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Link direto para o destino da notificação (usado fora do card). */
export function NotificationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm underline">
      {label}
    </Link>
  );
}
