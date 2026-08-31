import { ExtractedField } from "../src/common/extraction/extraction-provider.interface";
import { GroundTruthDocument } from "../src/common/extraction/acceptance-test/ground-truth.types";
import {
  evaluateAgainstTargets,
  mergeCounts,
  PILOT_ACCEPTANCE_TARGETS,
  scoreDocument,
  toRates,
} from "../src/common/extraction/acceptance-test/scoring";

const groundTruth: GroundTruthDocument = {
  id: "doc-1",
  reportTypeCode: "MAINTENANCE_CLEANING",
  fields: [
    { fieldName: "Customer Name", sourceType: "printed", fieldKind: "text", expectedValue: "Acme Corp", expectedUnit: null, expectedMeasurementTypeCode: null },
    {
      fieldName: "Low Side Pressure",
      sourceType: "handwritten",
      fieldKind: "numeric",
      expectedValue: "65",
      expectedUnit: "psi",
      expectedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
      groupKey: "unit-1",
    },
    { fieldName: "Filter Cleaned", sourceType: "printed", fieldKind: "checkbox", expectedValue: "checked", expectedUnit: null, expectedMeasurementTypeCode: null },
    { fieldName: "Not Actually Present", sourceType: "handwritten", fieldKind: "text", expectedValue: null, expectedUnit: null, expectedMeasurementTypeCode: null },
  ],
};

describe("scoreDocument", () => {
  it("scores a perfect extraction as 100% across every applicable metric", () => {
    const extracted: ExtractedField[] = [
      { category: "basicInfo", fieldName: "Customer Name", value: "Acme Corp", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
      {
        category: "measurement",
        fieldName: "Low Side Pressure",
        value: "65",
        unit: "psi",
        confidence: "high",
        suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE",
        groupKey: "unit-1",
      },
      { category: "basicInfo", fieldName: "Filter Cleaned", value: "checked", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
      { category: "basicInfo", fieldName: "Not Actually Present", value: null, unit: null, confidence: "unreadable", suggestedMeasurementTypeCode: null },
    ];

    const counts = scoreDocument(extracted, groundTruth);
    const rates = toRates(counts);

    expect(rates.printedTextAccuracy).toBe(1);
    expect(rates.handwrittenNumericAccuracy).toBe(1);
    expect(rates.valueUnitPreservationRate).toBe(1);
    expect(rates.checkboxAccuracy).toBe(1);
    expect(rates.equipmentRowAssociationAccuracy).toBe(1);
    expect(rates.taxonomySuggestionAccuracy).toBe(1);
    expect(rates.hallucinationRate).toBe(0);
    expect(counts.unmatchedGroundTruthCount).toBe(0);
    expect(counts.extraExtractedCount).toBe(0);
  });

  it("flags a hallucination when the model reports a value for a field that was genuinely blank", () => {
    const extracted: ExtractedField[] = [
      { category: "basicInfo", fieldName: "Not Actually Present", value: "invented reading", unit: null, confidence: "medium", suggestedMeasurementTypeCode: null },
    ];
    const counts = scoreDocument(extracted, { id: "d", reportTypeCode: "X", fields: [groundTruth.fields[3]] });
    const rates = toRates(counts);
    expect(rates.hallucinationRate).toBe(1);
  });

  it("does not penalize correct abstention (both expected and extracted are null)", () => {
    const extracted: ExtractedField[] = [
      { category: "basicInfo", fieldName: "Not Actually Present", value: null, unit: null, confidence: "unreadable", suggestedMeasurementTypeCode: null },
    ];
    const counts = scoreDocument(extracted, { id: "d", reportTypeCode: "X", fields: [groundTruth.fields[3]] });
    expect(toRates(counts).hallucinationRate).toBe(0);
  });

  it("treats a wrong value as a value/unit-preservation miss but not necessarily a hallucination", () => {
    const extracted: ExtractedField[] = [
      { category: "measurement", fieldName: "Low Side Pressure", value: "70", unit: "psi", confidence: "high", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", groupKey: "unit-1" },
    ];
    const counts = scoreDocument(extracted, { id: "d", reportTypeCode: "X", fields: [groundTruth.fields[1]] });
    const rates = toRates(counts);
    expect(rates.valueUnitPreservationRate).toBe(0);
    expect(rates.hallucinationRate).toBe(0); // ground truth had a real value, this is a wrong reading, not an invented one
  });

  it("flags a unit change as a value/unit-preservation miss even when the numeric value matches", () => {
    const extracted: ExtractedField[] = [
      { category: "measurement", fieldName: "Low Side Pressure", value: "65", unit: "kPa", confidence: "high", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", groupKey: "unit-1" },
    ];
    const counts = scoreDocument(extracted, { id: "d", reportTypeCode: "X", fields: [groundTruth.fields[1]] });
    expect(toRates(counts).valueUnitPreservationRate).toBe(0);
  });

  it("counts an extra extracted field with a value and no ground-truth counterpart as a hallucination", () => {
    const extracted: ExtractedField[] = [{ category: "basicInfo", fieldName: "Never Asked About", value: "surprise", unit: null, confidence: "high", suggestedMeasurementTypeCode: null }];
    const counts = scoreDocument(extracted, { id: "d", reportTypeCode: "X", fields: [] });
    expect(counts.extraExtractedCount).toBe(1);
    expect(toRates(counts).hallucinationRate).toBe(1);
  });

  it("counts an unmatched ground-truth field (nothing extracted at all) without crashing", () => {
    const counts = scoreDocument([], groundTruth);
    expect(counts.unmatchedGroundTruthCount).toBe(groundTruth.fields.length);
  });

  it("scores a correct taxonomy abstention (both expected and suggested are null) as correct", () => {
    const extracted: ExtractedField[] = [
      { category: "basicInfo", fieldName: "Customer Name", value: "Acme Corp", unit: null, confidence: "high", suggestedMeasurementTypeCode: null },
    ];
    const counts = scoreDocument(extracted, { id: "d", reportTypeCode: "X", fields: [groundTruth.fields[0]] });
    expect(toRates(counts).taxonomySuggestionAccuracy).toBe(1);
  });
});

describe("mergeCounts", () => {
  it("sums counts across multiple documents field-by-field", () => {
    const a = scoreDocument(
      [{ category: "basicInfo", fieldName: "Customer Name", value: "Acme Corp", unit: null, confidence: "high", suggestedMeasurementTypeCode: null }],
      { id: "d1", reportTypeCode: "X", fields: [groundTruth.fields[0]] },
    );
    const b = scoreDocument(
      [{ category: "basicInfo", fieldName: "Customer Name", value: "Wrong", unit: null, confidence: "high", suggestedMeasurementTypeCode: null }],
      { id: "d2", reportTypeCode: "X", fields: [groundTruth.fields[0]] },
    );
    const merged = mergeCounts([a, b]);
    expect(merged.printedTotal).toBe(2);
    expect(merged.printedCorrect).toBe(1);
    expect(toRates(merged).printedTextAccuracy).toBe(0.5);
  });
});

describe("evaluateAgainstTargets", () => {
  it("marks a criterion as passing when the rate meets or exceeds its target", () => {
    const rates = {
      printedTextAccuracy: 0.99,
      handwrittenNumericAccuracy: 0.95,
      valueUnitPreservationRate: 0.98,
      checkboxAccuracy: 0.95,
      equipmentRowAssociationAccuracy: 0.95,
      taxonomySuggestionAccuracy: 0.95,
      hallucinationRate: 0,
    };
    const rows = evaluateAgainstTargets(rates);
    expect(rows.every((r) => r.meetsTarget === true)).toBe(true);
  });

  it("marks hallucinationRate as failing when above zero, even though higher is 'better' for every other metric", () => {
    const rates = {
      printedTextAccuracy: 1,
      handwrittenNumericAccuracy: 1,
      valueUnitPreservationRate: 1,
      checkboxAccuracy: 1,
      equipmentRowAssociationAccuracy: 1,
      taxonomySuggestionAccuracy: 1,
      hallucinationRate: 0.01,
    };
    const rows = evaluateAgainstTargets(rates);
    const hallucinationRow = rows.find((r) => r.criterion === "hallucinationRate")!;
    expect(hallucinationRow.meetsTarget).toBe(false);
  });

  it("marks a criterion with no data (null rate) as meetsTarget: null, not a silent pass or fail", () => {
    const rates = {
      printedTextAccuracy: null,
      handwrittenNumericAccuracy: null,
      valueUnitPreservationRate: null,
      checkboxAccuracy: null,
      equipmentRowAssociationAccuracy: null,
      taxonomySuggestionAccuracy: null,
      hallucinationRate: null,
    };
    const rows = evaluateAgainstTargets(rates);
    expect(rows.every((r) => r.meetsTarget === null)).toBe(true);
  });

  it("covers every pilot acceptance target the user approved", () => {
    const rows = evaluateAgainstTargets(toRates(mergeCounts([])));
    const criteria = rows.map((r) => r.criterion).sort();
    expect(criteria).toEqual(Object.keys(PILOT_ACCEPTANCE_TARGETS).sort());
  });
});
