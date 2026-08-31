import type { AuditLogEntry } from "@/lib/api";

// Turns a raw action string like "service_report_locked" into "service
// report locked" — good enough for a human-scannable feed without a
// hand-maintained label table for every action ever logged across every
// module (Steps 1-7 alone already log a dozen distinct actions).
function humanizeAction(action: string): string {
  return action.replaceAll("_", " ");
}

export function RecentActivityList({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0">
          <span>
            {humanizeAction(entry.action)}
            {entry.entityType && <span className="text-muted-foreground"> · {entry.entityType}</span>}
          </span>
          <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
