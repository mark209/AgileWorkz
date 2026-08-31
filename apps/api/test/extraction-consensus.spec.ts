import { reconcile, reconcileSingleCall } from "../src/common/extraction/extraction-consensus";
import { ExtractedField } from "../src/common/extraction/extraction-provider.interface";

// Phase 5 Stage C, step 3 (selective verification / reconciliation) — pure,
// offline unit tests over already-extracted field lists from up to 3 calls.
// No AI call anywhere in this file.

function field(overrides: Partial<ExtractedField>): ExtractedField {
  return {
    category: "measurement",
    fieldName: "Voltage",
    value: "220",
    unit: "V",
    confidence: "high",
    suggestedMeasurementTypeCode: "VOLTAGE",
    ...overrides,
  };
}

describe("reconcileSingleCall", () => {
  it("tags every field as single-call, not requiring human verification", () => {
    const fields = [field({}), field({ fieldName: "Current", suggestedMeasurementTypeCode: "CURRENT" })];
    const result = reconcileSingleCall(fields);
    expect(result).toHaveLength(2);
    for (const f of result) {
      expect(f.reconciliationStatus).toBe("single-call");
      expect(f.requiresHumanVerification).toBe(false);
    }
  });

  it("preserves the original field's value and confidence unchanged", () => {
    const result = reconcileSingleCall([field({ value: "220", confidence: "medium" })]);
    expect(result[0].value).toBe("220");
    expect(result[0].confidence).toBe("medium");
  });
});

describe("reconcile", () => {
  it("marks a field unanimous when all 3 calls agree exactly", () => {
    const perCall = [[field({ value: "220" })], [field({ value: "220" })], [field({ value: "220" })]];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("unanimous");
    expect(result[0].value).toBe("220");
    expect(result[0].confidence).toBe("high");
  });

  it("treats a value/unit split as equivalent to the same value written with its unit inline", () => {
    const perCall = [
      [field({ value: "220", unit: "V" })],
      [field({ value: "220V", unit: null })],
      [field({ value: "220", unit: "V" })],
    ];
    const result = reconcile(perCall);
    expect(result[0].reconciliationStatus).toBe("unanimous");
  });

  it("accepts the majority value on a 2-of-3 split and downgrades confidence one step", () => {
    const perCall = [
      [field({ value: "220", confidence: "high" })],
      [field({ value: "220", confidence: "high" })],
      [field({ value: "280", confidence: "high" })],
    ];
    const result = reconcile(perCall);
    expect(result[0].reconciliationStatus).toBe("majority");
    expect(result[0].value).toBe("220");
    expect(result[0].confidence).toBe("medium");
  });

  // Never invent a value merely to obtain consensus: a genuine 3-way split
  // on a numeric field must resolve to null/unreadable, not to any one
  // call's guess.
  it("resolves a 3-way disagreement on a non-checkbox field to unresolved/null, flagged for human verification", () => {
    const perCall = [
      [field({ value: "220" })],
      [field({ value: "230" })],
      [field({ value: "240" })],
    ];
    const result = reconcile(perCall);
    expect(result[0].reconciliationStatus).toBe("unresolved");
    expect(result[0].value).toBeNull();
    expect(result[0].confidence).toBe("unreadable");
    expect(result[0].requiresHumanVerification).toBe(true);
  });

  // Correction 4 (checkbox coverage): a checkbox found by only 1 of 3 calls
  // is a coverage gap, not a hallucination risk — include it at low
  // confidence instead of dropping it or marking it unresolved.
  it("recovers a checkbox found by only one of three calls, at low confidence, without flagging for human verification", () => {
    const perCall: ExtractedField[][] = [
      [field({ category: "narrativeItem", fieldName: "Air Filter Clean", value: "checked", unit: null, suggestedMeasurementTypeCode: null })],
      [],
      [],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("majority");
    expect(result[0].value).toBe("checked");
    expect(result[0].confidence).toBe("low");
    expect(result[0].requiresHumanVerification).toBe(false);
  });

  // Field labels are not stable across calls (Stage B finding) — matching
  // must be by normalized/positional signature, not exact fieldName text.
  // suggestedMeasurementTypeCode is explicitly null here so this test
  // actually exercises the name-based FALLBACK identity path, not the
  // taxonomy-code path (see the dedicated code-based tests below).
  it("matches the same field across calls despite differing label wording and word order (name-based fallback)", () => {
    const perCall = [
      [field({ fieldName: "PRESSURE HIGH", value: "410", suggestedMeasurementTypeCode: null })],
      [field({ fieldName: "Pressure High", value: "410", suggestedMeasurementTypeCode: null })],
      [field({ fieldName: "High Pressure", value: "410", suggestedMeasurementTypeCode: null })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("unanimous");
    expect(result[0].value).toBe("410");
  });

  // Stage C.1 acceptance criteria #4/#8: free-text/General Service Report
  // layouts describe the same reading very differently call to call.
  // Taxonomy-code identity (preferred whenever a code is present) is what
  // lets these reconcile despite the wording having almost nothing in
  // common.
  it("matches wildly different free-text label wording via the shared taxonomy code, not the fieldName text", () => {
    const perCall = [
      [field({ fieldName: "Line 1", value: "12.4", suggestedMeasurementTypeCode: "CURRENT_L1" })],
      [field({ fieldName: "L1", value: "12.4", suggestedMeasurementTypeCode: "CURRENT_L1" })],
      [field({ fieldName: "Operating Ampere Line 1", value: "12.4", suggestedMeasurementTypeCode: "CURRENT_L1" })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("unanimous");
    expect(result[0].value).toBe("12.4");
  });

  // Stage C.1 acceptance criteria #5: labels that share surface wording but
  // are genuinely different measurements must NOT be merged just because
  // they look similar. Taxonomy-code identity protects against this
  // specifically because the two codes differ.
  it("does not merge similar-looking labels that carry different taxonomy codes", () => {
    const perCall = [
      [
        field({ fieldName: "Suction (Indoor Unit Air Temp)", value: "20.5", suggestedMeasurementTypeCode: "INDOOR_RETURN_AIR_TEMPERATURE" }),
        field({ fieldName: "Suction (Outdoor Unit Air Temp)", value: "33.9", suggestedMeasurementTypeCode: "OUTDOOR_SUCTION_AIR_TEMPERATURE" }),
      ],
      [
        field({ fieldName: "Suction Indoor", value: "20.5", suggestedMeasurementTypeCode: "INDOOR_RETURN_AIR_TEMPERATURE" }),
        field({ fieldName: "Suction Outdoor", value: "33.9", suggestedMeasurementTypeCode: "OUTDOOR_SUCTION_AIR_TEMPERATURE" }),
      ],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(2);
    const byCode = new Map(result.map((f) => [f.suggestedMeasurementTypeCode, f.value]));
    expect(byCode.get("INDOOR_RETURN_AIR_TEMPERATURE")).toBe("20.5");
    expect(byCode.get("OUTDOOR_SUCTION_AIR_TEMPERATURE")).toBe("33.9");
    for (const f of result) expect(f.reconciliationStatus).toBe("unanimous");
  });

  // A code-based identity match should not silently ignore a genuinely
  // different value just because two fields share a code — this is still
  // real voting, just keyed differently.
  // Stage C.1 acceptance-test finding (real VRV1 rerun): a single loose
  // taxonomy code can cover a whole GROUP of distinct checkboxes ("GOOD" /
  // "NO GOOD"). Code-based identity would cross-match an unchecked "NO
  // GOOD" against an unrelated checked item sharing the same code —
  // checkbox-shaped fields must always match by label text instead.
  it("matches checkbox-shaped fields by label text even when they share one taxonomy code with a DIFFERENT checkbox", () => {
    const perCall = [
      [
        field({ fieldName: "Outdoor Installation Condition Good", value: "checked", suggestedMeasurementTypeCode: "INSTALLATION_CONDITION" }),
        field({ fieldName: "Outdoor Installation Condition No Good", value: "unchecked", suggestedMeasurementTypeCode: "INSTALLATION_CONDITION" }),
      ],
      [
        field({ fieldName: "Outdoor Installation Condition Good", value: "checked", suggestedMeasurementTypeCode: "INSTALLATION_CONDITION" }),
        field({ fieldName: "Outdoor Installation Condition No Good", value: "unchecked", suggestedMeasurementTypeCode: "INSTALLATION_CONDITION" }),
      ],
      [
        // Deliberately reordered — the point is label matching, not
        // reading order, decides identity for these.
        field({ fieldName: "Outdoor Installation Condition No Good", value: "unchecked", suggestedMeasurementTypeCode: "INSTALLATION_CONDITION" }),
        field({ fieldName: "Outdoor Installation Condition Good", value: "checked", suggestedMeasurementTypeCode: "INSTALLATION_CONDITION" }),
      ],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(2);
    const good = result.find((f) => f.fieldName.toLowerCase().includes("no good") === false)!;
    const noGood = result.find((f) => f.fieldName.toLowerCase().includes("no good"))!;
    expect(good.value).toBe("checked");
    expect(good.reconciliationStatus).toBe("unanimous");
    expect(noGood.value).toBe("unchecked");
    expect(noGood.reconciliationStatus).toBe("unanimous");
  });

  it("still detects real disagreement between code-matched observations", () => {
    const perCall = [
      [field({ fieldName: "Line 1", value: "12.4", suggestedMeasurementTypeCode: "CURRENT_L1" })],
      [field({ fieldName: "L1", value: "21.0", suggestedMeasurementTypeCode: "CURRENT_L1" })],
      [field({ fieldName: "Operating Current L1", value: "33.5", suggestedMeasurementTypeCode: "CURRENT_L1" })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("unresolved");
    expect(result[0].value).toBeNull();
  });

  // Stage-label wording varies just as much as fieldName wording
  // ("BEFORE_OPERATION" vs "Prior to Operation" vs "Before Repair") — the
  // canonical before/after/during buckets must collapse these too.
  it("matches the same field across calls despite differing stage-label wording for the same before/after concept", () => {
    const perCall = [
      [field({ fieldName: "Voltage L1-L2", value: "401", stage: "BEFORE_OPERATION" })],
      [field({ fieldName: "VOLTAGE L1L2", value: "401", stage: "Prior to Operation" })],
      [field({ fieldName: "L1 & L2 Voltage", value: "401", stage: "Before Repair" })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("unanimous");
    expect(result[0].value).toBe("401");
  });

  // An unrecognized, genuinely distinct stage keeps its own bucket rather
  // than being guessed into before/after/during.
  it("keeps two different unrecognized stage labels as distinct occurrences rather than merging them", () => {
    const perCall = [
      [
        field({ fieldName: "Voltage", value: "220", stage: "Startup Test" }),
        field({ fieldName: "Voltage", value: "225", stage: "Load Test" }),
      ],
      [
        field({ fieldName: "Voltage", value: "220", stage: "Startup Test" }),
        field({ fieldName: "Voltage", value: "225", stage: "Load Test" }),
      ],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(2);
    const values = result.map((f) => f.value).sort();
    expect(values).toEqual(["220", "225"]);
  });

  // Stage C acceptance-test finding (real Bayshore document): one call
  // wrote "Voltage L1-L2", another wrote "VOLTAGE L1L2" for the exact same
  // physical reading. Without hyphen-gluing these produce different
  // signatures and the reading gets split into two separately-voted,
  // under-observed slots — silently weakening the very consensus guarantee
  // this whole module exists to provide.
  it("matches the same field across calls despite a hyphen appearing in only some calls' wording, via the name fallback (no code present)", () => {
    const perCall = [
      [field({ fieldName: "Voltage L1-L2", value: "220", stage: "BEFORE", suggestedMeasurementTypeCode: null })],
      [field({ fieldName: "VOLTAGE L1L2", value: "220", stage: "BEFORE", suggestedMeasurementTypeCode: null })],
      [field({ fieldName: "Voltage L1-L2", value: "220", stage: "BEFORE", suggestedMeasurementTypeCode: null })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    expect(result[0].reconciliationStatus).toBe("unanimous");
  });

  it("does not conflate two distinct occurrences of the same signature within one call", () => {
    const perCall = [
      [field({ fieldName: "Voltage", value: "220", groupKey: "unit-1" }), field({ fieldName: "Voltage", value: "225", groupKey: "unit-2" })],
      [field({ fieldName: "Voltage", value: "220", groupKey: "A" }), field({ fieldName: "Voltage", value: "225", groupKey: "B" })],
      [field({ fieldName: "Voltage", value: "220", groupKey: "1" }), field({ fieldName: "Voltage", value: "225", groupKey: "2" })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(2);
    const values = result.map((f) => f.value).sort();
    expect(values).toEqual(["220", "225"]);
    for (const f of result) expect(f.reconciliationStatus).toBe("unanimous");
  });

  it("reconciles from only 2 calls when the third call failed and was excluded", () => {
    const perCall = [[field({ value: "220" })], [field({ value: "220" })]];
    const result = reconcile(perCall);
    expect(result[0].reconciliationStatus).toBe("unanimous");
    expect(result[0].value).toBe("220");
  });

  it("keeps a field observed by only some calls without inventing an observation for the call that omitted it, and treats the miss as a partial disagreement", () => {
    const perCall = [
      [field({ fieldName: "Customer Name", category: "basicInfo", value: "Acme", unit: null, confidence: "high", suggestedMeasurementTypeCode: null })],
      [],
      [field({ fieldName: "Customer Name", category: "basicInfo", value: "Acme", unit: null, confidence: "high", suggestedMeasurementTypeCode: null })],
    ];
    const result = reconcile(perCall);
    expect(result).toHaveLength(1);
    // 2 of 3 calls agree (the 3rd never reported this field at all, which
    // itself counts against unanimity) — majority, confidence downgraded,
    // the field is still kept rather than dropped or nulled.
    expect(result[0].reconciliationStatus).toBe("majority");
    expect(result[0].value).toBe("Acme");
    expect(result[0].confidence).toBe("medium");
  });
});
