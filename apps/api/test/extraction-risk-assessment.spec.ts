import { assessRisk } from "../src/common/extraction/extraction-risk-assessment";
import { reconcile } from "../src/common/extraction/extraction-consensus";
import { ExtractedField } from "../src/common/extraction/extraction-provider.interface";
import { ReconciledField } from "../src/common/extraction/adaptive-extraction.types";

// Phase 5 Stage C.1 — pure, offline unit tests. assessRisk() runs AFTER
// extraction-consensus.ts has already voted; its whole point is that
// consensus (even unanimous) does not by itself prove a critical value is
// correct. No AI call anywhere in this file.

function rawField(overrides: Partial<ExtractedField> = {}): ExtractedField {
  return {
    category: "measurement",
    fieldName: "Thermostat Setting",
    value: "20",
    unit: "°C",
    confidence: "high",
    suggestedMeasurementTypeCode: "THERMOSTAT_SETTING",
    ...overrides,
  };
}

function reconciledField(overrides: Partial<ReconciledField> = {}): ReconciledField {
  const base = rawField();
  return {
    ...base,
    reconciliationStatus: "unanimous",
    requiresHumanVerification: false,
    contributingObservations: [base, base, base],
    groupOccurrenceIndex: 1,
    ...overrides,
  };
}

describe("assessRisk — systematic shared misreads (format/range re-check on the winning value)", () => {
  it("flags a UNANIMOUS critical reading that is out of the plausible range, without changing its value", () => {
    // All 3 independent calls agreeing on "170" for a thermostat setting
    // (plausible range 0-40) is exactly the Stage C finding: shared,
    // systematic misreads survive majority AND unanimous voting alike.
    const field = reconciledField({ value: "170", unit: null, reconciliationStatus: "unanimous" });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(true);
    expect(result.fields[0].value).toBe("170"); // preserved verbatim, never replaced with a guess
    expect(result.fields[0].confidence).toBe(field.confidence); // untouched
    expect(result.triggers.map((t) => t.reason)).toContain("post-consensus-implausible-range");
  });

  it("flags a UNANIMOUS critical reading with a suspicious (non-numeric-shaped) value", () => {
    const field = reconciledField({
      fieldName: "Breaker Capacity",
      suggestedMeasurementTypeCode: "BREAKER_CAPACITY",
      value: "ISA",
      unit: null,
      reconciliationStatus: "unanimous",
    });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(true);
    expect(result.fields[0].value).toBe("ISA");
    expect(result.triggers.map((t) => t.reason)).toContain("post-consensus-suspicious-format");
  });

  it("does not flag a unanimous, in-range, well-formatted critical reading", () => {
    const field = reconciledField({ value: "22", unit: "°C", reconciliationStatus: "unanimous" });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(false);
    expect(result.triggers).toEqual([]);
  });

  it("does not flag a non-critical field even with an unusual-looking value", () => {
    const field = reconciledField({ category: "narrativeItem", fieldName: "Notes", value: "garbled???", suggestedMeasurementTypeCode: null });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(false);
  });
});

describe("assessRisk — majority is insufficient for critical fields", () => {
  it("flags a critical field resolved by majority even though the winning value itself looks perfectly plausible", () => {
    // "One corrupted extraction vs. two correct extractions": the majority
    // value ("220") is fine on its face, but 2-of-3 agreement on a critical
    // reading still means real disagreement occurred, which Stage C.1
    // treats as insufficient certainty on its own for this field class.
    const field = reconciledField({ value: "220", unit: "V", suggestedMeasurementTypeCode: "VOLTAGE", reconciliationStatus: "majority", confidence: "medium" });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(true);
    expect(result.fields[0].value).toBe("220"); // still not replaced
    expect(result.triggers.map((t) => t.reason)).toContain("majority-consensus-insufficient-for-critical-field");
  });

  it("does not apply the majority-insufficient rule to a non-critical field", () => {
    const field = reconciledField({ category: "basicInfo", fieldName: "Customer Name", value: "Acme", suggestedMeasurementTypeCode: null, reconciliationStatus: "majority" });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(false);
  });

  it("does not flag an unresolved field a second time for the same reason (already flagged by reconciliation)", () => {
    const field = reconciledField({ value: null, reconciliationStatus: "unresolved", requiresHumanVerification: true, confidence: "unreadable" });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(true);
    expect(result.triggers.map((t) => t.reason)).not.toContain("majority-consensus-insufficient-for-critical-field");
  });
});

describe("assessRisk — low confidence among contributing calls", () => {
  it("flags a critical field when one of its contributing raw observations was itself low-confidence, even though the winning value is unanimous", () => {
    // Handwritten-numeric-field scenario: 3 calls land on the same digits,
    // but one of them only did so with self-reported low confidence — a
    // real signal of a hard-to-read source that pure vote-counting hides.
    const confident = rawField({ value: "20" });
    const uncertain = rawField({ value: "20", confidence: "low" });
    const field = reconciledField({ value: "20", reconciliationStatus: "unanimous", contributingObservations: [confident, confident, uncertain] });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(true);
    expect(result.triggers.map((t) => t.reason)).toContain("low-confidence-among-contributing-calls");
  });

  it("does not flag when every contributing observation was high confidence", () => {
    const confident = rawField({ value: "20" });
    const field = reconciledField({ value: "20", reconciliationStatus: "unanimous", contributingObservations: [confident, confident, confident] });
    const result = assessRisk([field]);
    expect(result.fields[0].requiresHumanVerification).toBe(false);
  });
});

describe("assessRisk — contradictory related readings", () => {
  it("flags both readings when high-side pressure does not exceed low-side pressure for the same unit", () => {
    const high = reconciledField({ fieldName: "High Side Pressure", suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE", value: "100", unit: "psi", groupOccurrenceIndex: 1 });
    const low = reconciledField({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", value: "115", unit: "psi", groupOccurrenceIndex: 1 });
    const result = assessRisk([high, low]);
    expect(result.fields.find((f) => f.suggestedMeasurementTypeCode === "HIGH_SIDE_PRESSURE")!.requiresHumanVerification).toBe(true);
    expect(result.fields.find((f) => f.suggestedMeasurementTypeCode === "LOW_SIDE_PRESSURE")!.requiresHumanVerification).toBe(true);
    expect(result.triggers.map((t) => t.reason)).toContain("contradictory-pressure-reading");
  });

  it("does not flag a physically consistent high/low pressure pair", () => {
    const high = reconciledField({ fieldName: "High Side Pressure", suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE", value: "410", unit: "psi", groupOccurrenceIndex: 1 });
    const low = reconciledField({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", value: "115", unit: "psi", groupOccurrenceIndex: 1 });
    const result = assessRisk([high, low]);
    expect(result.fields.every((f) => !f.requiresHumanVerification)).toBe(true);
  });

  // Structured, repeating-unit form scenario: 3 outdoor units, only the
  // 2nd unit's pressures are physically contradictory. Only that unit's
  // pair should be flagged — groupOccurrenceIndex isolates units from each
  // other so one bad unit doesn't taint the other two.
  it("isolates the contradictory-pressure check per unit in a multi-unit structured form", () => {
    const fields = [
      reconciledField({ fieldName: "High Side Pressure", suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE", value: "410", groupOccurrenceIndex: 1 }),
      reconciledField({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", value: "115", groupOccurrenceIndex: 1 }),
      reconciledField({ fieldName: "High Side Pressure", suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE", value: "90", groupOccurrenceIndex: 2 }),
      reconciledField({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", value: "115", groupOccurrenceIndex: 2 }),
      reconciledField({ fieldName: "High Side Pressure", suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE", value: "410", groupOccurrenceIndex: 3 }),
      reconciledField({ fieldName: "Low Side Pressure", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", value: "115", groupOccurrenceIndex: 3 }),
    ];
    const result = assessRisk(fields);
    const flaggedIndexes = result.fields.filter((f) => f.requiresHumanVerification).map((f) => f.groupOccurrenceIndex);
    expect(new Set(flaggedIndexes)).toEqual(new Set([2]));
  });

  it("flags a voltage phase reading that is far outside the balance tolerance of its sibling phases", () => {
    const fields = [
      reconciledField({ fieldName: "Voltage L1-L2", suggestedMeasurementTypeCode: "VOLTAGE_L1_L2", value: "400", groupOccurrenceIndex: 1 }),
      reconciledField({ fieldName: "Voltage L1-L3", suggestedMeasurementTypeCode: "VOLTAGE_L1_L3", value: "396", groupOccurrenceIndex: 1 }),
      reconciledField({ fieldName: "Voltage L2-L3", suggestedMeasurementTypeCode: "VOLTAGE_L2_L3", value: "150", groupOccurrenceIndex: 1 }),
    ];
    const result = assessRisk(fields);
    expect(result.fields.some((f) => f.requiresHumanVerification)).toBe(true);
    expect(result.triggers.map((t) => t.reason)).toContain("voltage-phase-imbalance");
  });

  it("does not flag voltage phases within the generous balance tolerance", () => {
    const fields = [
      reconciledField({ fieldName: "Voltage L1-L2", suggestedMeasurementTypeCode: "VOLTAGE_L1_L2", value: "401", groupOccurrenceIndex: 1 }),
      reconciledField({ fieldName: "Voltage L1-L3", suggestedMeasurementTypeCode: "VOLTAGE_L1_L3", value: "396", groupOccurrenceIndex: 1 }),
      reconciledField({ fieldName: "Voltage L2-L3", suggestedMeasurementTypeCode: "VOLTAGE_L2_L3", value: "400", groupOccurrenceIndex: 1 }),
    ];
    const result = assessRisk(fields);
    expect(result.fields.every((f) => !f.requiresHumanVerification)).toBe(true);
  });
});

describe("assessRisk — integration with reconcile() on a free-text layout", () => {
  // Ties Stage C.1's two mechanisms together: differently-worded voltage
  // labels reconcile into one field via the taxonomy code (Stage C.1 item
  // 2), and that reconciled field is still subject to the post-consensus
  // risk checks (Stage C.1 item 1) even though it reached "unanimous".
  it("flags a unanimous, code-matched reading from free-text labels when it fails a plausibility check", () => {
    const perCall = [
      [rawField({ fieldName: "Thermostat", value: "170", unit: null })],
      [rawField({ fieldName: "Thermostat Setting (°C)", value: "170", unit: null })],
      [rawField({ fieldName: "TSTAT SETTING", value: "170", unit: null })],
    ];
    const reconciled = reconcile(perCall);
    expect(reconciled[0].reconciliationStatus).toBe("unanimous");
    const result = assessRisk(reconciled);
    expect(result.fields[0].requiresHumanVerification).toBe(true);
    expect(result.fields[0].value).toBe("170");
  });
});
