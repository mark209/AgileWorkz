"use client";

import { useState } from "react";
import type { AuditLogEntry } from "@/lib/api";

// Turns a raw action string like "service_report_locked" into "service
// report locked" — good enough for a human-scannable feed without a
// hand-maintained label table for every action ever logged across every
// module (Steps 1-7 alone already log a dozen distinct actions).
function humanizeAction(action: string): string {
  const words = action.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RecentActivityList({ entries }: { entries: AuditLogEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleEntries = showAll ? entries : entries.slice(0, 5);
  return (
    <div>
      <ul className="flex flex-col gap-2 text-sm">
        {visibleEntries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0">
            <span>
              {humanizeAction(entry.action)}
              {entry.entityType && <span className="text-muted-foreground"> · {entry.entityType.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {entries.length > 5 && (
        <button type="button" className="mt-3 text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowAll((current) => !current)}>
          {showAll ? "Show fewer activities" : `Show ${entries.length - 5} more activities`}
        </button>
      )}
    </div>
  );
}
