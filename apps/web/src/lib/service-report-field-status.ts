import type { ExtractionReviewStatus, StagedFieldView } from "./api/service-report-verification";

/**
 * The single displayed status for one field, derived from (reviewStatus,
 * requiresHumanVerification, aiConfidence, aiValue) — never stored
 * separately, always computed fresh from the same source data the backend
 * returns, so the UI can never drift from what the API actually persisted.
 */
export type FieldDisplayStatus =
  | "needs-follow-up"
  | "unresolved"
  | "requires-verification"
  | "low-confidence"
  | "blank"
  | "high-confidence"
  | "confirmed"
  | "corrected"
  | "confirmed-blank";

export function getFieldDisplayStatus(field: StagedFieldView): FieldDisplayStatus {
  switch (field.reviewStatus) {
    case "NEEDS_FOLLOW_UP":
      return "needs-follow-up";
    case "CONFIRMED":
      return "confirmed";
    case "CORRECTED":
      return "corrected";
    case "CONFIRMED_BLANK":
      return "confirmed-blank";
    case null:
    default:
      if (field.aiConfidence === "UNREADABLE") return "unresolved";
      if (field.requiresHumanVerification) return "requires-verification";
      if (field.aiValue === null) return "blank";
      // A LOW-confidence field is never itself sufficient evidence of a
      // problem worth an automatic requiresHumanVerification flag (that
      // flag is scoped to critical fields — see extraction-risk-assessment
      // .ts), but it must never be visually indistinguishable from a
      // genuinely high-confidence one either — a reviewer needs to see
      // this, even for a non-critical field.
      if (field.aiConfidence === "LOW") return "low-confidence";
      return "high-confidence";
  }
}

/**
 * Lower number = shown first. Fields still needing a decision (or a
 * revisit, for NEEDS_FOLLOW_UP) sort before fields already safely resolved,
 * per the approved requirement to prioritize attention-required fields —
 * "place them before ordinary safe fields where practical".
 */
const ATTENTION_RANK: Record<FieldDisplayStatus, number> = {
  "needs-follow-up": 0,
  unresolved: 1,
  "requires-verification": 2,
  "low-confidence": 3,
  blank: 4,
  "high-confidence": 5,
  corrected: 6,
  confirmed: 7,
  "confirmed-blank": 7,
};

export function getAttentionRank(field: StagedFieldView): number {
  return ATTENTION_RANK[getFieldDisplayStatus(field)];
}

/** Stable sort — fields sharing an attention rank keep their original (rowIndex/fieldName) order. */
export function sortByAttention(fields: StagedFieldView[]): StagedFieldView[] {
  return fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => getAttentionRank(a.field) - getAttentionRank(b.field) || a.index - b.index)
    .map((entry) => entry.field);
}

export interface ReviewProgress {
  total: number;
  reviewed: number;
  remaining: number;
  needsFollowUp: number;
}

export function computeReviewProgress(allFields: StagedFieldView[]): ReviewProgress {
  const total = allFields.length;
  const reviewed = allFields.filter((f) => f.reviewStatus !== null).length;
  const needsFollowUp = allFields.filter((f) => f.reviewStatus === "NEEDS_FOLLOW_UP").length;
  return { total, reviewed, remaining: total - reviewed, needsFollowUp };
}

/** Mirrors the backend's completeness rule exactly (service-report-verification.service.ts): every field reviewed, and none NEEDS_FOLLOW_UP. Used only to enable/disable the button client-side — the server re-checks this authoritatively regardless. */
export function canCompleteVerification(progress: ReviewProgress): boolean {
  return progress.remaining === 0 && progress.needsFollowUp === 0;
}

/**
 * Bulk-confirm eligibility, mirrored client-side from
 * ServiceReportVerificationService.isEligibleForBulkConfirm for immediate
 * UI feedback (e.g. graying out a field about to be bulk-confirmed) — the
 * server's own check in previewBulkConfirm/bulkConfirmEligibleFields is
 * always the authoritative one.
 */
export function isEligibleForBulkConfirm(field: StagedFieldView): boolean {
  return (
    field.aiValue !== null &&
    (field.aiConfidence === "HIGH" || field.aiConfidence === "MEDIUM") &&
    !field.requiresHumanVerification &&
    field.reviewStatus === null
  );
}

export const REVIEW_STATUS_LABELS: Record<ExtractionReviewStatus, string> = {
  CONFIRMED: "Confirmed",
  CORRECTED: "Corrected",
  CONFIRMED_BLANK: "Confirmed Blank",
  NEEDS_FOLLOW_UP: "Needs Follow-Up",
};

export const FIELD_STATUS_LABELS: Record<FieldDisplayStatus, string> = {
  "needs-follow-up": "Needs Follow-Up",
  unresolved: "Unreadable / Unresolved",
  "requires-verification": "Requires Human Verification",
  "low-confidence": "Low Confidence",
  blank: "Blank",
  "high-confidence": "High Confidence",
  confirmed: "Confirmed",
  corrected: "Corrected",
  "confirmed-blank": "Confirmed Blank",
};
