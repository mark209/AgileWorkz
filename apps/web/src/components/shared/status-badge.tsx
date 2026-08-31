import { Badge } from "@/components/ui/badge";

// One mapping, reused by every Step 8 screen, so a given status always
// carries the same color meaning everywhere — never a per-page decision.
const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "neutral" | "destructive"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  OUT_OF_SERVICE: "warning",
  DECOMMISSIONED: "destructive",

  // Phase 3 — QuotationRevisionStatus (§10). PENDING_APPROVAL/SENT are both
  // "waiting on someone" states (amber); ACCEPTED is the one true
  // terminal-good outcome (green); REJECTED/DECLINED are both terminal-bad
  // (red) despite being semantically distinct (internal vs. customer, see
  // Step 7); EXPIRED/SUPERSEDED are terminal-neutral, deliberately not red —
  // neither is a rejection.
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "default",
  REJECTED: "destructive",
  SENT: "warning",
  ACCEPTED: "success",
  DECLINED: "destructive",
  EXPIRED: "neutral",
  SUPERSEDED: "neutral",

  // Phase 3 — InquiryStatus.
  OPEN: "default",
  CONVERTED: "success",
  CLOSED: "neutral",

  // Phase 5 — ServiceReportStatus. EXTRACTION_FAILED is the one true error
  // state (red); PENDING_* are both "waiting on a process/person" (amber);
  // VERIFIED/CONFIRMED/LOCKED are each a further-along good outcome, kept
  // visually distinct rather than collapsed into one "done" color so the
  // pipeline stage is legible from the badge alone.
  PENDING_EXTRACTION: "warning",
  EXTRACTION_FAILED: "destructive",
  PENDING_VERIFICATION: "warning",
  VERIFIED: "success",
  CONFIRMED: "default",
  LOCKED: "neutral",

  // Phase 4 — WorkOrderStatus. DRAFT/CLOSED already covered above (shared
  // with Quotation/Inquiry). SCHEDULED is "waiting" (amber, same family as
  // PENDING_APPROVAL/SENT); IN_PROGRESS is the active-work state (default,
  // matching APPROVED/CONFIRMED's "in motion" treatment); COMPLETED is a
  // good outcome short of the final CLOSED sign-off; CANCELLED is
  // terminal-bad, same red as REJECTED/DECLINED.
  SCHEDULED: "warning",
  IN_PROGRESS: "default",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  OUT_OF_SERVICE: "Out of Service",
  DECOMMISSIONED: "Decommissioned",

  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  SUPERSEDED: "Superseded",

  OPEN: "Open",
  CONVERTED: "Converted",
  CLOSED: "Closed",

  PENDING_EXTRACTION: "Pending Extraction",
  EXTRACTION_FAILED: "Extraction Failed",
  PENDING_VERIFICATION: "Pending Verification",
  VERIFIED: "Verified",
  CONFIRMED: "Confirmed",
  LOCKED: "Locked",

  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}
