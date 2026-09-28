import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLoading() {
  return (
    <div className="border-border bg-card space-y-6 rounded-xl border p-6 shadow-sm">
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-7 w-32" />
        <Skeleton className="mx-auto h-4 w-56" />
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="mx-auto h-3 w-48" />
    </div>
  );
}
