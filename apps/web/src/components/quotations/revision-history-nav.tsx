import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import type { QuotationRevision } from "@/lib/api";

// Every past revision is shown but read-only once selected unless it's
// both is_current AND DRAFT — the parent (page.tsx) is the single source
// of truth for that editability check, this component only handles
// selection and display.
export function RevisionHistoryNav({
  revisions,
  viewingRevisionId,
  onSelect,
}: {
  revisions: QuotationRevision[];
  viewingRevisionId: string;
  onSelect: (revisionId: string) => void;
}) {
  const sorted = [...revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revision history:</span>
      {sorted.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            r.id === viewingRevisionId ? "border-primary bg-accent" : "hover:bg-muted",
          )}
        >
          Rev {r.revisionNumber}
          <StatusBadge status={r.status} />
          {r.isCurrent && <span className="text-muted-foreground">(current)</span>}
        </button>
      ))}
    </div>
  );
}
