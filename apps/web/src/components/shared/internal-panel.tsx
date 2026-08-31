import { ReactNode } from "react";
import { Lock } from "lucide-react";

// Wraps any internal-commercial content (unit cost, markup, gross profit/
// margin, material/labor costing breakdown) in a visually distinct
// container — amber-tinted, labeled "Internal only" — so it can never be
// mistaken for customer-facing selling information at a glance. Reused
// everywhere those fields appear (line item form, revision summary), per
// the "clear separation between selling and internal commercial
// information" requirement.
export function InternalPanel({ title = "Internal only — not shown to the customer", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-800">
        <Lock className="h-3 w-3" aria-hidden="true" />
        {title}
      </div>
      {children}
    </div>
  );
}
