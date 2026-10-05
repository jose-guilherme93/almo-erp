import Link from "next/link";
import type { ReactNode } from "react";

import { AppNav } from "@/components/layout/app-nav";
import { BranchSwitcher, type BranchOption } from "@/components/layout/branch-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@/lib/constants";
import { APP_VERSION, BUILD_TIME } from "@/lib/version";
import { prisma } from "@/lib/db";
import { visibleNavigation } from "@/lib/navigation";
import { logoutAction } from "@/server/actions/auth";
import { requirePageSession } from "@/server/auth/guards";
import { latestUnread, unreadCount } from "@/server/services/notification/inbox";

/**
 * Shell da área autenticada.
 *
 * O guard vive aqui: toda rota dentro de `(app)` passa por ele. Um usuário
 * suspenso perde acesso na requisição seguinte, mesmo com JWT ainda válido,
 * porque o contexto é relido do banco.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requirePageSession();

  const branchOptions: BranchOption[] = context.memberships.map((membership) => ({
    id: membership.branchId,
    code: membership.branchCode,
    name: membership.branchName,
    roleName: membership.roleName,
  }));

  const activeMembership = context.activeBranchId
    ? context.getMembership(context.activeBranchId)
    : undefined;

  // Contador do sino e lista curta: mesma fonte usada pelo dashboard.
  // A contagem de unidades ativas é o que define se transferência é ruído.
  const [unread, latest, activeBranchCount] = await Promise.all([
    unreadCount(context.user.id),
    latestUnread(context.user.id, 5),
    prisma.branch.count({ where: { active: true, id: { in: context.branchIds } } }),
  ]);

  const sections = visibleNavigation(
    (permission) => context.hasPermission(permission),
    context.isNetworkScope,
    activeBranchCount,
  ).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({ label: item.label, href: item.href })),
  }));

  return (
    <div className="flex min-h-svh">
      {/* Sidebar fixa no desktop */}
      <aside className="bg-sidebar hidden w-64 shrink-0 border-r lg:block print:hidden">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/meu" className="font-semibold tracking-tight">
            {APP_NAME}
          </Link>
        </div>
        <div className="flex h-[calc(100svh-3.5rem)] flex-col">
          <div className="min-h-0 flex-1">
            <AppNav sections={sections} />
          </div>
          <div className="border-t px-4 py-2">
            <span
              className="text-muted-foreground text-xs"
              title={BUILD_TIME ? `Build: ${BUILD_TIME}` : undefined}
            >
              {APP_VERSION}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background sticky top-0 z-30 border-b print:hidden">
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
            <MobileNav sections={sections} />

            <Link href="/meu" className="font-semibold tracking-tight lg:hidden">
              {APP_NAME}
            </Link>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <BranchSwitcher branches={branchOptions} activeBranchId={context.activeBranchId} />

              {activeMembership ? (
                <Badge
                  variant={activeMembership.branchType === "MATRIX" ? "default" : "secondary"}
                  className="hidden sm:inline-flex"
                >
                  {activeMembership.roleName}
                </Badge>
              ) : null}

              <NotificationBell
                unread={unread}
                latest={latest.map((notification) => ({
                  id: notification.id,
                  title: notification.title,
                  body: notification.body,
                  link: notification.link,
                  createdAt: notification.createdAt.toISOString(),
                }))}
              />

              <span className="text-muted-foreground hidden text-sm xl:inline">
                {context.user.name}
              </span>

              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Sair
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
