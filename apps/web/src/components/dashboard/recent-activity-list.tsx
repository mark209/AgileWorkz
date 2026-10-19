"use client";

import { useState } from "react";
import type { AuditLogEntry } from "@/lib/api";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

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
      <ul className="divide-y text-sm">
        {visibleEntries.map((entry) => (
          <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-medium">{humanizeAction(entry.action)}</span>
              <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">{dateTimeFormatter.format(new Date(entry.createdAt))}</time>
            </div>
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Details</summary>
              <div className="mt-1 space-y-0.5">
                <p>Record type: {entry.entityType.replace(/([a-z])([A-Z])/g, "$1 $2")}</p>
                {entry.entityId && <p>Record ID: {entry.entityId}</p>}
                <p>Actor: {entry.actorType}{entry.actorUserId ? ` (${entry.actorUserId})` : ""}</p>
              </div>
            </details>
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
