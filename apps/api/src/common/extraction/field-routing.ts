/**
 * Bridges the provider-facing ExtractedField shape (semantic `groupKey`,
 * `category`) to the six extraction_* staging tables' shape (one row per
 * table category, positional integer `rowIndex`). The provider is never
 * asked to invent stable sequential integers — that's unreliable for a
 * model — only to group fields it can reason about semantically; this
 * module does the positional translation.
 */

import { ExtractedField, ExtractionFieldCategory } from "./extraction-provider.interface";

// Structurally accepts a plain ExtractedField (requiresHumanVerification
// absent, treated as false downstream) or a ReconciledField
// (adaptive-extraction.types.ts) without either module importing the
// other's type — ReconciledField's required boolean already satisfies this
// optional one.
export type FieldWithOptionalReviewFlag = ExtractedField & { requiresHumanVerification?: boolean };

export type RoutedFields = Record<ExtractionFieldCategory, FieldWithOptionalReviewFlag[]>;

export function routeFieldsByCategory(fields: FieldWithOptionalReviewFlag[]): RoutedFields {
  const routed: RoutedFields = {
    basicInfo: [],
    equipmentUnit: [],
    problem: [],
    measurement: [],
    narrativeItem: [],
    signoff: [],
  };
  for (const field of fields) {
    routed[field.category].push(field);
  }
  return routed;
}

export interface StagingRow {
  rowIndex: number;
  fieldName: string;
  value: string | null;
  unit: string | null;
  confidence: ExtractedField["confidence"];
  suggestedMeasurementTypeCode: string | null;
  stage: string | null;
  /**
   * Phase 5 Step 5 — carried through from ReconciledField when the caller
   * has one (the queue processor always does, via AdaptiveExtractionResult)
   * so StagingWriterService can persist it. Defaults to false for a plain
   * ExtractedField, which has no such concept — field-routing.ts itself
   * doesn't depend on the adaptive pipeline's types, only on this optional
   * structural property.
   */
  requiresHumanVerification: boolean;
}

/**
 * Assigns each distinct groupKey within one category's fields a stable
 * integer row_index, in first-seen order, starting at 0. Fields with no
 * groupKey all share row_index 0 — matching the DB column's own default and
 * the existing convention that non-repeating fields (report header, a
 * single narrative note) don't need a distinct row per field.
 */
export function assignRowIndexes(fields: FieldWithOptionalReviewFlag[]): StagingRow[] {
  // Reserve row_index 0 for ungrouped fields specifically when any exist in
  // this batch, so a real group (e.g. the first equipment unit) can never
  // collide with — and be conflated with — the "no group" bucket. When
  // every field is grouped, the first group legitimately starts at 0.
  const hasUngroupedField = fields.some((field) => field.groupKey === undefined);
  const rowIndexByGroupKey = new Map<string, number>();
  let nextRowIndex = hasUngroupedField ? 1 : 0;

  return fields.map((field) => {
    let rowIndex = 0;
    if (field.groupKey !== undefined) {
      const existing = rowIndexByGroupKey.get(field.groupKey);
      if (existing !== undefined) {
        rowIndex = existing;
      } else {
        rowIndex = nextRowIndex;
        nextRowIndex += 1;
        rowIndexByGroupKey.set(field.groupKey, rowIndex);
      }
    }
    return {
      rowIndex,
      fieldName: field.fieldName,
      value: field.value,
      unit: field.unit,
      confidence: field.confidence,
      suggestedMeasurementTypeCode: field.suggestedMeasurementTypeCode,
      stage: field.stage ?? null,
      requiresHumanVerification: field.requiresHumanVerification ?? false,
    };
  });
}
