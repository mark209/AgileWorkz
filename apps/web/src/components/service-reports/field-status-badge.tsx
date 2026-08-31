import { Badge } from "@/components/ui/badge";
import type { FieldDisplayStatus } from "@/lib/service-report-field-status";
import { FIELD_STATUS_LABELS } from "@/lib/service-report-field-status";

// One mapping, reused everywhere a field's status appears, so the same
// status always carries the same color meaning across the whole
// verification screen — same convention as shared/status-badge.tsx.
const FIELD_STATUS_VARIANT: Record<FieldDisplayStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "neutral"> = {
  "needs-follow-up": "destructive",
  unresolved: "destructive",
  "requires-verification": "warning",
  "low-confidence": "warning",
  blank: "neutral",
  "high-confidence": "outline",
  confirmed: "success",
  corrected: "default",
  "confirmed-blank": "secondary",
};

export function FieldStatusBadge({ status }: { status: FieldDisplayStatus }) {
  return <Badge variant={FIELD_STATUS_VARIANT[status]}>{FIELD_STATUS_LABELS[status]}</Badge>;
}
