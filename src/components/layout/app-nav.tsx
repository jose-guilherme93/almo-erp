"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type NavLink = { label: string; href: string };
export type NavSection = { label: string; items: NavLink[] };

/**
 * Navegação lateral.
 *
 * Cliente apenas para marcar o item ativo com `usePathname`. A lista já vem
 * filtrada por permissão do servidor.
 */
export function AppNav({
  sections,
  onNavigate,
}: {
  sections: NavSection[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/meu" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <ScrollArea className="h-full">
      <nav className="space-y-6 px-3 py-4" aria-label="Navegação principal">
        {sections.map((section) => (
          <div key={section.label} className="space-y-1">
            <p className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">
              {section.label}
            </p>

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2 py-1.5 text-sm transition-colors",
                        "focus-visible:ring-ring outline-none focus-visible:ring-2",
                        active
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </ScrollArea>
  );
}
