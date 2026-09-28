import Link from "next/link";
import type { ReactNode } from "react";

import { AppNav } from "@/components/layout/app-nav";
import { BranchSwitcher, type BranchOption } from "@/components/layout/branch-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@/lib/constants";
import { visibleNavigation } from "@/lib/navigation";
import { logoutAction } from "@/server/actions/auth";
import { requirePageSession } from "@/server/auth/guards";

/**
 * Shell da área autenticada.
 *
 * O guard vive aqui: toda rota dentro de `(app)` passa por ele. Um usuário
 * suspenso perde acesso na requisição seguinte, mesmo com JWT ainda válido,
 * porque o contexto é relido do banco.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requirePageSession();

  const sections = visibleNavigation(
    (permission) => context.hasPermission(permission),
    context.isNetworkScope,
  ).map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({ label: item.label, href: item.href })),
  }));

  const branchOptions: BranchOption[] = context.memberships.map((membership) => ({
    id: membership.branchId,
    code: membership.branchCode,
    name: membership.branchName,
    roleName: membership.roleName,
  }));

  const activeMembership = context.activeBranchId
    ? context.getMembership(context.activeBranchId)
    : undefined;

  return (
    <div className="flex min-h-svh">
      {/* Sidebar fixa no desktop */}
      <aside className="bg-sidebar hidden w-64 shrink-0 border-r lg:block">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/meu" className="font-semibold tracking-tight">
            {APP_NAME}
          </Link>
        </div>
        <div className="h-[calc(100svh-3.5rem)]">
          <AppNav sections={sections} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background sticky top-0 z-30 border-b">
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
