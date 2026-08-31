import { describe, expect, it } from "vitest";
import type { StagedFieldView } from "./api/service-report-verification";
import {
  canCompleteVerification,
  computeReviewProgress,
  getAttentionRank,
  getFieldDisplayStatus,
  isEligibleForBulkConfirm,
  sortByAttention,
} from "./service-report-field-status";

function field(overrides: Partial<StagedFieldView> = {}): StagedFieldView {
  return {
    id: "f1",
    category: "measurement",
    rowIndex: 0,
    fieldName: "low_side_pressure",
    aiValue: "65",
    aiUnit: "psi",
    aiConfidence: "HIGH",
    suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
    stage: null,
    requiresHumanVerification: false,
    reviewStatus: null,
    verifiedValue: null,
    verifiedBy: null,
    verifiedAt: null,
    ...overrides,
  };
}

describe("getFieldDisplayStatus", () => {
  it("returns needs-follow-up when reviewStatus is NEEDS_FOLLOW_UP, regardless of confidence", () => {
    expect(getFieldDisplayStatus(field({ reviewStatus: "NEEDS_FOLLOW_UP", aiConfidence: "HIGH" }))).toBe("needs-follow-up");
  });

  it("returns confirmed/corrected/confirmed-blank for their respective reviewStatus values", () => {
    expect(getFieldDisplayStatus(field({ reviewStatus: "CONFIRMED" }))).toBe("confirmed");
    expect(getFieldDisplayStatus(field({ reviewStatus: "CORRECTED" }))).toBe("corrected");
    expect(getFieldDisplayStatus(field({ reviewStatus: "CONFIRMED_BLANK", aiValue: null }))).toBe("confirmed-blank");
  });

  it("returns unresolved for an unreviewed UNREADABLE field, even if requiresHumanVerification is false", () => {
    expect(getFieldDisplayStatus(field({ reviewStatus: null, aiConfidence: "UNREADABLE", requiresHumanVerification: false }))).toBe(
      "unresolved",
    );
  });

  it("returns requires-verification for an unreviewed, non-unreadable field flagged by the adaptive pipeline", () => {
    expect(getFieldDisplayStatus(field({ reviewStatus: null, aiConfidence: "HIGH", requiresHumanVerification: true }))).toBe(
      "requires-verification",
    );
  });

  it("returns blank for an unreviewed field with no AI value and no other flag", () => {
    expect(getFieldDisplayStatus(field({ reviewStatus: null, aiValue: null, aiConfidence: null, requiresHumanVerification: false }))).toBe(
      "blank",
    );
  });

  it("returns high-confidence for an unreviewed, unflagged HIGH or MEDIUM confidence field with a value", () => {
    expect(getFieldDisplayStatus(field({ reviewStatus: null, aiConfidence: "MEDIUM", requiresHumanVerification: false }))).toBe(
      "high-confidence",
    );
    expect(getFieldDisplayStatus(field({ reviewStatus: null, aiConfidence: "HIGH", requiresHumanVerification: false }))).toBe(
      "high-confidence",
    );
  });

  // Regression test: a LOW-confidence, unflagged field must never render as
  // "High Confidence" — caught via live browser verification of the actual
  // running UI, not just a code read-through.
  it("returns low-confidence, never high-confidence, for an unreviewed LOW-confidence unflagged field", () => {
    const status = getFieldDisplayStatus(field({ reviewStatus: null, aiConfidence: "LOW", requiresHumanVerification: false }));
    expect(status).toBe("low-confidence");
    expect(status).not.toBe("high-confidence");
  });
});

describe("sortByAttention", () => {
  it("places needs-follow-up and unresolved fields before safe/resolved ones", () => {
    const safe = field({ id: "safe", reviewStatus: null, requiresHumanVerification: false, aiConfidence: "HIGH" });
    const followUp = field({ id: "follow-up", reviewStatus: "NEEDS_FOLLOW_UP" });
    const unresolved = field({ id: "unresolved", reviewStatus: null, aiConfidence: "UNREADABLE" });
    const confirmed = field({ id: "confirmed", reviewStatus: "CONFIRMED" });

    const sorted = sortByAttention([safe, confirmed, followUp, unresolved]);
    expect(sorted.map((f) => f.id)).toEqual(["follow-up", "unresolved", "safe", "confirmed"]);
  });

  it("is stable — fields with the same attention rank keep their relative order", () => {
    const a = field({ id: "a", reviewStatus: "CONFIRMED" });
    const b = field({ id: "b", reviewStatus: "CONFIRMED" });
    expect(sortByAttention([a, b]).map((f) => f.id)).toEqual(["a", "b"]);
    expect(sortByAttention([b, a]).map((f) => f.id)).toEqual(["b", "a"]);
  });

  it("gives requires-verification a lower (more urgent) rank than an unreviewed blank field", () => {
    const blank = field({ id: "blank", reviewStatus: null, aiValue: null, requiresHumanVerification: false });
    const flagged = field({ id: "flagged", reviewStatus: null, requiresHumanVerification: true });
    expect(getAttentionRank(flagged)).toBeLessThan(getAttentionRank(blank));
  });

  it("gives low-confidence a rank between requires-verification and blank", () => {
    const flagged = field({ id: "flagged", reviewStatus: null, requiresHumanVerification: true });
    const low = field({ id: "low", reviewStatus: null, aiConfidence: "LOW", requiresHumanVerification: false });
    const blank = field({ id: "blank", reviewStatus: null, aiValue: null, requiresHumanVerification: false });
    expect(getAttentionRank(flagged)).toBeLessThan(getAttentionRank(low));
    expect(getAttentionRank(low)).toBeLessThan(getAttentionRank(blank));
  });
});

describe("computeReviewProgress", () => {
  it("counts total/reviewed/remaining/needsFollowUp across a mixed set", () => {
    const fields = [
      field({ id: "1", reviewStatus: "CONFIRMED" }),
      field({ id: "2", reviewStatus: "CORRECTED" }),
      field({ id: "3", reviewStatus: null }),
      field({ id: "4", reviewStatus: "NEEDS_FOLLOW_UP" }),
    ];
    const progress = computeReviewProgress(fields);
    expect(progress).toEqual({ total: 4, reviewed: 3, remaining: 1, needsFollowUp: 1 });
  });

  it("reports total 0 for an empty field list (a report with no staged data at all)", () => {
    expect(computeReviewProgress([])).toEqual({ total: 0, reviewed: 0, remaining: 0, needsFollowUp: 0 });
  });
});

describe("canCompleteVerification", () => {
  it("is false while any field remains unreviewed", () => {
    expect(canCompleteVerification({ total: 2, reviewed: 1, remaining: 1, needsFollowUp: 0 })).toBe(false);
  });

  it("is false while any field is NEEDS_FOLLOW_UP, even if every field has technically been reviewed", () => {
    expect(canCompleteVerification({ total: 2, reviewed: 2, remaining: 0, needsFollowUp: 1 })).toBe(false);
  });

  it("is true once every field is reviewed and none needs follow-up", () => {
    expect(canCompleteVerification({ total: 2, reviewed: 2, remaining: 0, needsFollowUp: 0 })).toBe(true);
  });

  it("is true for a report with zero staged fields at all", () => {
    expect(canCompleteVerification({ total: 0, reviewed: 0, remaining: 0, needsFollowUp: 0 })).toBe(true);
  });
});

describe("isEligibleForBulkConfirm", () => {
  it("is eligible for HIGH or MEDIUM confidence, unflagged, unreviewed fields with a value", () => {
    expect(isEligibleForBulkConfirm(field({ aiConfidence: "HIGH" }))).toBe(true);
    expect(isEligibleForBulkConfirm(field({ aiConfidence: "MEDIUM" }))).toBe(true);
  });

  it("excludes LOW confidence", () => {
    expect(isEligibleForBulkConfirm(field({ aiConfidence: "LOW" }))).toBe(false);
  });

  it("excludes UNREADABLE confidence", () => {
    expect(isEligibleForBulkConfirm(field({ aiConfidence: "UNREADABLE" }))).toBe(false);
  });

  it("excludes fields flagged requiresHumanVerification", () => {
    expect(isEligibleForBulkConfirm(field({ aiConfidence: "HIGH", requiresHumanVerification: true }))).toBe(false);
  });

  it("excludes blank fields unconditionally", () => {
    expect(isEligibleForBulkConfirm(field({ aiValue: null, aiConfidence: null }))).toBe(false);
  });

  it("excludes fields already reviewed", () => {
    expect(isEligibleForBulkConfirm(field({ aiConfidence: "HIGH", reviewStatus: "CONFIRMED" }))).toBe(false);
  });
});
