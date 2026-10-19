import Link from "next/link";

export interface WorkflowStatus {
  label: string;
  count: number;
  href?: string;
}

export interface WorkflowGroup {
  label: string;
  statuses: WorkflowStatus[];
}

export function WorkflowOverview({ groups }: { groups: WorkflowGroup[] }) {
  return (
    <div className="divide-y">
      {groups.map((group) => (
        <details key={group.label} className="group py-1 first:pt-0 last:pb-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>{group.label}</span>
            <span className="flex items-center gap-3 text-xs font-normal text-muted-foreground">
              {group.statuses.length} tracked statuses
              <span aria-hidden="true" className="text-base leading-none transition-transform group-open:rotate-90">›</span>
            </span>
          </summary>
          <ul className="pb-2 pl-1">
            {group.statuses.map((status) => (
              <li key={status.label} className="flex min-h-9 items-center justify-between gap-3 border-t py-2 text-sm first:border-t-0">
                {status.href ? (
                  <Link href={status.href} className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {status.label}
                  </Link>
                ) : (
                  <span>{status.label}</span>
                )}
                <span className="tabular-nums font-semibold">{status.count}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
