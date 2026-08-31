/**
 * Scoring logic for the provider acceptance test (Phase 5 Approved Baseline
 * §04a-13). Pure functions only — no network access, no database, no
 * dependency on which ExtractionProvider produced the input. This is what
 * lets the harness's own correctness be unit-tested against synthetic
 * fixtures (test/extraction-acceptance-scoring.spec.ts) independently of
 * whether a real Gemini/Vertex integration exists yet.
 *
 * Field matching is by (groupKey, fieldName) — a simple key-based join
 * rather than any positional/coordinate matching. Ground truth and
 * extracted fields are expected to use the same fieldName vocabulary,
 * matching what the source document actually labels each field.
 */

import { ExtractedField } from "../extraction-provider.interface";
import { GroundTruthDocument, GroundTruthField } from "./ground-truth.types";

export interface AcceptanceCounts {
  fieldCount: number;
  matchedFieldCount: number;
  unmatchedGroundTruthCount: number;
  extraExtractedCount: number;
  printedCorrect: number;
  printedTotal: number;
  handwrittenNumericCorrect: number;
  handwrittenNumericTotal: number;
  valueUnitCorrect: number;
  valueUnitTotal: number;
  checkboxCorrect: number;
  checkboxTotal: number;
  groupCorrect: number;
  groupTotal: number;
  taxonomyCorrect: number;
  taxonomyTotal: number;
  hallucinatedCount: number;
  hallucinationOpportunityCount: number;
}

function emptyCounts(): AcceptanceCounts {
  return {
    fieldCount: 0,
    matchedFieldCount: 0,
    unmatchedGroundTruthCount: 0,
    extraExtractedCount: 0,
    printedCorrect: 0,
    printedTotal: 0,
    handwrittenNumericCorrect: 0,
    handwrittenNumericTotal: 0,
    valueUnitCorrect: 0,
    valueUnitTotal: 0,
    checkboxCorrect: 0,
    checkboxTotal: 0,
    groupCorrect: 0,
    groupTotal: 0,
    taxonomyCorrect: 0,
    taxonomyTotal: 0,
    hallucinatedCount: 0,
    hallucinationOpportunityCount: 0,
  };
}

function matchKey(fieldName: string, groupKey?: string): string {
  return groupKey ? `${groupKey}::${fieldName}` : fieldName;
}

export function scoreDocument(extracted: ExtractedField[], groundTruth: GroundTruthDocument): AcceptanceCounts {
  const counts = emptyCounts();

  const groundTruthByKey = new Map<string, GroundTruthField>();
  for (const gt of groundTruth.fields) {
    groundTruthByKey.set(matchKey(gt.fieldName, gt.groupKey), gt);
  }
  const extractedByKey = new Map<string, ExtractedField>();
  for (const field of extracted) {
    extractedByKey.set(matchKey(field.fieldName, field.groupKey), field);
  }

  counts.fieldCount = groundTruthByKey.size;

  for (const [key, gt] of groundTruthByKey) {
    const extractedField = extractedByKey.get(key);
    if (!extractedField) {
      counts.unmatchedGroundTruthCount += 1;
      continue;
    }
    counts.matchedFieldCount += 1;

    const valueMatches = extractedField.value === gt.expectedValue;
    const unitMatches = extractedField.unit === gt.expectedUnit;

    if (gt.sourceType === "printed") {
      counts.printedTotal += 1;
      if (valueMatches) counts.printedCorrect += 1;
    }
    if (gt.sourceType === "handwritten" && gt.fieldKind === "numeric") {
      counts.handwrittenNumericTotal += 1;
      if (valueMatches) counts.handwrittenNumericCorrect += 1;
    }

    counts.valueUnitTotal += 1;
    if (valueMatches && unitMatches) counts.valueUnitCorrect += 1;

    if (gt.fieldKind === "checkbox") {
      counts.checkboxTotal += 1;
      if (valueMatches) counts.checkboxCorrect += 1;
    }

    if (gt.groupKey) {
      counts.groupTotal += 1;
      if (extractedField.groupKey === gt.groupKey) counts.groupCorrect += 1;
    }

    counts.taxonomyTotal += 1;
    if (extractedField.suggestedMeasurementTypeCode === gt.expectedMeasurementTypeCode) counts.taxonomyCorrect += 1;

    // Hallucination: the model reported a concrete value where the ground
    // truth says nothing was actually there. The single most safety-
    // critical metric — see Phase 5 Approved Baseline §04a-13.
    counts.hallucinationOpportunityCount += 1;
    if (gt.expectedValue === null && extractedField.value !== null) {
      counts.hallucinatedCount += 1;
    }
  }

  for (const [key, extractedField] of extractedByKey) {
    if (!groundTruthByKey.has(key)) {
      counts.extraExtractedCount += 1;
      counts.hallucinationOpportunityCount += 1;
      // An extracted field with no ground-truth counterpart at all is a
      // hallucinated field, unless it's a correctly-abstained null.
      if (extractedField.value !== null) {
        counts.hallucinatedCount += 1;
      }
    }
  }

  return counts;
}

export function mergeCounts(all: AcceptanceCounts[]): AcceptanceCounts {
  const merged = emptyCounts();
  for (const c of all) {
    for (const key of Object.keys(merged) as (keyof AcceptanceCounts)[]) {
      merged[key] += c[key];
    }
  }
  return merged;
}

export interface AcceptanceRates {
  printedTextAccuracy: number | null;
  handwrittenNumericAccuracy: number | null;
  valueUnitPreservationRate: number | null;
  checkboxAccuracy: number | null;
  equipmentRowAssociationAccuracy: number | null;
  taxonomySuggestionAccuracy: number | null;
  hallucinationRate: number | null;
}

function rate(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total;
}

export function toRates(counts: AcceptanceCounts): AcceptanceRates {
  return {
    printedTextAccuracy: rate(counts.printedCorrect, counts.printedTotal),
    handwrittenNumericAccuracy: rate(counts.handwrittenNumericCorrect, counts.handwrittenNumericTotal),
    valueUnitPreservationRate: rate(counts.valueUnitCorrect, counts.valueUnitTotal),
    checkboxAccuracy: rate(counts.checkboxCorrect, counts.checkboxTotal),
    equipmentRowAssociationAccuracy: rate(counts.groupCorrect, counts.groupTotal),
    taxonomySuggestionAccuracy: rate(counts.taxonomyCorrect, counts.taxonomyTotal),
    hallucinationRate: rate(counts.hallucinatedCount, counts.hallucinationOpportunityCount),
  };
}

/**
 * Pilot acceptance targets per the user's approved Decision-4 list. Subject
 * to adjustment after testing representative real reports — these are
 * starting targets, not permanently fixed thresholds.
 */
export const PILOT_ACCEPTANCE_TARGETS: Record<keyof AcceptanceRates, number> = {
  printedTextAccuracy: 0.98,
  handwrittenNumericAccuracy: 0.95,
  valueUnitPreservationRate: 0.98,
  checkboxAccuracy: 0.95,
  equipmentRowAssociationAccuracy: 0.95,
  taxonomySuggestionAccuracy: 0.95,
  hallucinationRate: 0,
};

export interface AcceptanceEvaluationRow {
  criterion: keyof AcceptanceRates;
  actual: number | null;
  target: number;
  /** null when there was no data to evaluate this criterion against (total = 0). */
  meetsTarget: boolean | null;
}

export function evaluateAgainstTargets(rates: AcceptanceRates): AcceptanceEvaluationRow[] {
  return (Object.keys(PILOT_ACCEPTANCE_TARGETS) as (keyof AcceptanceRates)[]).map((criterion) => {
    const actual = rates[criterion];
    const target = PILOT_ACCEPTANCE_TARGETS[criterion];
    let meetsTarget: boolean | null;
    if (actual === null) {
      meetsTarget = null;
    } else if (criterion === "hallucinationRate") {
      meetsTarget = actual <= target;
    } else {
      meetsTarget = actual >= target;
    }
    return { criterion, actual, target, meetsTarget };
  });
}
