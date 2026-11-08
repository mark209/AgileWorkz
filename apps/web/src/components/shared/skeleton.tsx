import { cn } from "@/lib/utils";

export function ContentReveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("content-reveal", className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} />;
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return <div role="status" aria-label="Loading table" className="space-y-3">
    {Array.from({ length: rows }, (_, row) => <div key={row} className="flex gap-4">
      {Array.from({ length: columns }, (_, col) => <Skeleton key={col} className={`h-5 ${col === 0 ? "w-1/3" : "flex-1"}`} />)}
    </div>)}
    <span className="sr-only">Loading…</span>
  </div>;
}

export function DashboardSkeleton() {
  return <div role="status" aria-label="Loading dashboard" className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <div className="space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72 max-w-full" /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-lg border p-4"><Skeleton className="mb-4 h-4 w-28" /><Skeleton className="h-8 w-20" /></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <div key={i} className="space-y-4 rounded-lg border p-5"><Skeleton className="h-5 w-36" />{Array.from({ length: 4 }, (_, row) => <Skeleton key={row} className="h-10 w-full" />)}</div>)}</div>
    <span className="sr-only">Loading dashboard…</span>
  </div>;
}
