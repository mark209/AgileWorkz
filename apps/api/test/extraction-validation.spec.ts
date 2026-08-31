import { evaluateExtraction } from "../src/common/extraction/extraction-validation";
import { ExtractedField, ExtractionContext } from "../src/common/extraction/extraction-provider.interface";

// Phase 5 Stage C, step 2 (deterministic validation) — pure, offline unit
// tests. No AI call anywhere in this file; evaluateExtraction() is plain
// rule-based logic over an already-extracted field list.

function field(overrides: Partial<ExtractedField>): ExtractedField {
  return {
    category: "measurement",
    fieldName: "Field",
    value: "1",
    unit: null,
    confidence: "high",
    suggestedMeasurementTypeCode: null,
    ...overrides,
  };
}

const startUpContext: ExtractionContext = {
  reportTypeCode: "INSTALLATION_COMMISSIONING",
  allowedMeasurementTypes: [],
  allowedMeasurementStages: [],
  allowedProblemTypes: [],
  allowedSignoffRoles: [],
};

const maintenanceContext: ExtractionContext = {
  ...startUpContext,
  reportTypeCode: "MAINTENANCE_CLEANING",
};

const generalServiceContext: ExtractionContext = {
  ...startUpContext,
  reportTypeCode: "GENERAL_SERVICE_REPAIR",
};

describe("evaluateExtraction", () => {
  it("finds nothing to verify in a clean, high-confidence extraction", () => {
    const fields = [
      field({ fieldName: "Voltage", value: "220", unit: "V", confidence: "high", suggestedMeasurementTypeCode: "VOLTAGE" }),
      field({ category: "basicInfo", fieldName: "Customer Name", value: "Acme HVAC", suggestedMeasurementTypeCode: null }),
    ];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
    expect(result.triggers).toEqual([]);
  });

  // Stage B failure mode: low-confidence critical measurement.
  it("triggers on a low-confidence critical measurement field", () => {
    const fields = [field({ fieldName: "Voltage", value: "220", confidence: "low", suggestedMeasurementTypeCode: "VOLTAGE" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(true);
    expect(result.triggers.map((t) => t.reason)).toContain("low-confidence-critical-field");
  });

  it("triggers on an unreadable critical measurement field", () => {
    const fields = [field({ fieldName: "Breaker Capacity", value: null, confidence: "unreadable", suggestedMeasurementTypeCode: "BREAKER_CAPACITY" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.triggers.map((t) => t.reason)).toContain("low-confidence-critical-field");
  });

  it("does not trigger on a low-confidence field that isn't a critical measurement type", () => {
    const fields = [field({ category: "narrativeItem", fieldName: "Notes", value: "some notes", confidence: "low", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  // Stage B failure mode: whole-run transcription instability producing
  // corrupted-looking values ("17C" for a thermostat setting, "ISA"/"159"
  // for a breaker capacity).
  // Stage B observed exactly this shape of corruption on a breaker-capacity
  // reading ("ISA" instead of a numeric amperage rating).
  it("triggers on a suspicious (non-numeric-shaped) value for a critical measurement", () => {
    const fields = [field({ fieldName: "Breaker Capacity", value: "ISA", confidence: "high", suggestedMeasurementTypeCode: "BREAKER_CAPACITY" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.triggers.map((t) => t.reason)).toContain("suspicious-value-format");
  });

  it("does not treat a recognized non-numeric literal (NA, Auto Charge) as suspicious", () => {
    const fields = [
      field({ fieldName: "Breaker Capacity", value: "NA", confidence: "high", suggestedMeasurementTypeCode: "BREAKER_CAPACITY" }),
      field({ fieldName: "Breaker Capacity 2", value: "Auto Charge", confidence: "high", suggestedMeasurementTypeCode: "BREAKER_CAPACITY" }),
    ];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  it("strips a known unit suffix before checking format, so a normally-shaped reading with its unit isn't flagged", () => {
    const fields = [field({ fieldName: "Voltage", value: "220V", confidence: "high", suggestedMeasurementTypeCode: "VOLTAGE" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  it("does not treat a fractional-inch pipe-size value as suspicious format", () => {
    const fields = [field({ fieldName: "Liquid Pipe Size", value: "3/8", confidence: "high", suggestedMeasurementTypeCode: "PIPE_SIZE_LIQUID" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  it("does not treat a mixed-number pipe-size value as suspicious format", () => {
    const fields = [field({ fieldName: "Gas Pipe Size", value: "1 3/8", confidence: "high", suggestedMeasurementTypeCode: "PIPE_SIZE_GAS" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  it("still treats a fraction-shaped value as suspicious on a non-pipe-size critical field", () => {
    const fields = [field({ fieldName: "Voltage", value: "3/8", confidence: "high", suggestedMeasurementTypeCode: "VOLTAGE" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.triggers.map((t) => t.reason)).toContain("suspicious-value-format");
  });

  it("triggers on an implausible out-of-range value for a critical measurement", () => {
    const fields = [field({ fieldName: "Voltage", value: "9000", confidence: "high", suggestedMeasurementTypeCode: "VOLTAGE" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.triggers.map((t) => t.reason)).toContain("implausible-value-range");
  });

  it("does not flag range on a value with no recognized critical measurement type code", () => {
    const fields = [field({ fieldName: "Mystery", value: "9000", confidence: "high", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  // Stage B failure mode: S/D taxonomy-policy violation — the deterministic
  // safety net independent of the prompt fix.
  it("triggers on a bare 1-2 letter fieldName that nonetheless got a confident taxonomy suggestion", () => {
    const fields = [field({ category: "measurement", fieldName: "S", value: "3/8", confidence: "high", suggestedMeasurementTypeCode: "PIPE_SIZE_LIQUID" })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.triggers.map((t) => t.reason)).toContain("unexplained-abbreviation-taxonomy-mapping");
  });

  it("does not trigger when the abbreviation has no taxonomy suggestion attached", () => {
    const fields = [field({ category: "measurement", fieldName: "S", value: "3/8", confidence: "high", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  it("does not trigger the abbreviation check when the field name is fully spelled out rather than a bare abbreviation", () => {
    const fields = [
      field({ category: "measurement", fieldName: "Liquid Pipe Size", value: "3/8", confidence: "high", suggestedMeasurementTypeCode: "PIPE_SIZE_LIQUID" }),
    ];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  // Stage B failure mode: checkbox extraction collapse — but scoped by
  // report type so a genuinely checkbox-free document type (Installation /
  // Start-Up / Commissioning) never gets penalized for having none.
  it("does not trigger zero-checkboxes-found for an Installation/Start-Up/Commissioning report", () => {
    const fields = [field({ category: "basicInfo", fieldName: "Customer Name", value: "Acme", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, startUpContext);
    expect(result.needsVerification).toBe(false);
  });

  it("triggers zero-checkboxes-found for a Maintenance/Cleaning report with real content but no checkboxes", () => {
    const fields = [field({ category: "basicInfo", fieldName: "Customer Name", value: "Acme", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, maintenanceContext);
    expect(result.triggers.map((t) => t.reason)).toContain("zero-checkboxes-found");
  });

  it("triggers zero-checkboxes-found for a General Service/Repair report with real content but no checkboxes", () => {
    const fields = [field({ category: "basicInfo", fieldName: "Customer Name", value: "Acme", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, generalServiceContext);
    expect(result.triggers.map((t) => t.reason)).toContain("zero-checkboxes-found");
  });

  it("does not trigger zero-checkboxes-found when checkboxes are present", () => {
    const fields = [
      field({ category: "basicInfo", fieldName: "Customer Name", value: "Acme", suggestedMeasurementTypeCode: null }),
      field({ category: "narrativeItem", fieldName: "Air Filter Clean", value: "checked", suggestedMeasurementTypeCode: null }),
    ];
    const result = evaluateExtraction(fields, maintenanceContext);
    expect(result.needsVerification).toBe(false);
  });

  it("does not trigger zero-checkboxes-found on a fully blank extraction (nothing to have coverage over)", () => {
    const fields = [field({ category: "basicInfo", fieldName: "Customer Name", value: null, confidence: "unreadable", suggestedMeasurementTypeCode: null })];
    const result = evaluateExtraction(fields, maintenanceContext);
    expect(result.needsVerification).toBe(false);
  });
});
