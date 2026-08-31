/**
 * Ground truth is prepared by a human transcribing a real sample form
 * BEFORE it is run through the provider — never derived from the provider's
 * own output. See Phase 5 Approved Baseline §04a-13.
 */

export type ExtractionFieldSourceType = "printed" | "handwritten";
export type ExtractionFieldKind = "text" | "numeric" | "checkbox";

export interface GroundTruthField {
  fieldName: string;
  sourceType: ExtractionFieldSourceType;
  fieldKind: ExtractionFieldKind;
  /** null means the field is genuinely blank/absent on the source document. */
  expectedValue: string | null;
  expectedUnit: string | null;
  /** null means this field correctly has no mapping among the approved measurement types. */
  expectedMeasurementTypeCode: string | null;
  groupKey?: string;
}

export interface GroundTruthDocument {
  id: string;
  reportTypeCode: string;
  fields: GroundTruthField[];
}
