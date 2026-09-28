import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto genérico das rotas autenticadas (AGENTS.md §6). */
export default function AppLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>

      <Skeleton className="h-64 w-full" />
    </div>
  );
}
