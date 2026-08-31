/**
 * Contract for the OCR/AI extraction worker (Phase 5 Step 3). Revised from
 * the Phase 1 stub-only shape per the approved provider implementation
 * design (Phase 5 Approved Baseline §04a):
 *
 * - The provider receives an already-fetched document (bytes + mime type),
 *   never a storage fileKey — the queue processor owns storage access, the
 *   provider only knows how to read bytes and produce fields. This keeps
 *   storage and AI-provider swaps fully independent of each other.
 * - value and unit are kept as two separate raw fields, both transcribed
 *   exactly as observed — the provider must never convert or normalize a
 *   unit (psi <-> kg/cm^2, degF <-> degC, in <-> mm, etc).
 * - suggestedMeasurementTypeCode is AI-generated staging data only. It must
 *   be one of ExtractionContext.allowedMeasurementTypes' codes, or null when
 *   the provider is not confident — never an invented code, never a forced
 *   nearest match. It can never become canonical on its own; only a human
 *   verifier (Phase 5 Step 5+) can confirm it into a real
 *   ServiceReportMeasurement.measurementTypeCode.
 *
 * See docs/architecture/ocr-worker-db-isolation.md for the database-
 * permission side of this boundary (the ocr_worker role that eventually
 * writes these fields into extraction_* staging tables has zero grant on
 * any canonical table).
 */

export interface ExtractionDocumentInput {
  /** Raw bytes, already retrieved by the queue processor — the provider never touches storage. */
  content: Buffer;
  /** e.g. "image/jpeg", "application/pdf". */
  mimeType: string;
  /** When known, for multi-page documents. */
  pageCount?: number;
}

export interface ExtractionTaxonomyOption {
  code: string;
  label: string;
}

/**
 * The controlled vocabularies the provider is allowed to reference. Built by
 * the queue processor from the live reference tables (measurement_types,
 * measurement_stages, problem_types, signoff_roles) — never hard-coded in
 * the provider, so a seeded taxonomy change needs no provider redeploy.
 */
export interface ExtractionContext {
  reportTypeCode: string;
  allowedMeasurementTypes: ExtractionTaxonomyOption[];
  allowedMeasurementStages: ExtractionTaxonomyOption[];
  allowedProblemTypes: ExtractionTaxonomyOption[];
  allowedSignoffRoles: ExtractionTaxonomyOption[];
}

export type ExtractionConfidence = "high" | "medium" | "low" | "unreadable";

/**
 * Which of the six extraction_* staging tables a field belongs to (Phase 5
 * Approved Baseline §04a, queue processor increment). A fixed, structural
 * set of six values — unlike suggestedMeasurementTypeCode's open-ended
 * taxonomy, this never grows by seeding, so it is safely constrained via the
 * provider's response schema `enum` (see vertex-gemini.provider.ts).
 */
export type ExtractionFieldCategory =
  | "basicInfo"
  | "equipmentUnit"
  | "problem"
  | "measurement"
  | "narrativeItem"
  | "signoff";

export interface ExtractedField {
  category: ExtractionFieldCategory;
  /** Raw/source field label, exactly as read from the document. */
  fieldName: string;
  /** Raw extracted value, exactly as observed — never converted or invented. */
  value: string | null;
  /** Raw extracted unit, exactly as observed — never converted or invented. Only meaningful for category "measurement". */
  unit: string | null;
  confidence: ExtractionConfidence;
  /**
   * Non-binding suggested mapping to one of ExtractionContext's approved
   * measurement type codes. Must be null when the provider cannot map the
   * field confidently — never a forced nearest match, never a code outside
   * the approved list. Only meaningful for category "measurement".
   */
  suggestedMeasurementTypeCode: string | null;
  /**
   * Raw stage label exactly as observed (e.g. a handwritten "before
   * cleaning"), never resolved to a measurement_stages code by the provider
   * — same "raw text, human resolves it later" rule as
   * suggestedMeasurementTypeCode. Only meaningful for category "measurement".
   */
  stage?: string;
  /**
   * Groups fields belonging to one repeating row (e.g. one equipment unit).
   * The queue processor — not the provider — maps distinct groupKey values
   * to the database's integer row_index, since asking a model to invent
   * stable sequential integers is unreliable; semantic grouping by label is
   * what it can do well.
   */
  groupKey?: string;
}

/**
 * Token usage for one extraction call, when the provider reports it —
 * needed for real cost tracking (Phase 5 Approved Baseline §04a-13
 * acceptance testing). Field names mirror Vertex AI's own usage metadata
 * categories exactly (see vertex-gemini.provider.ts's mapUsageMetadata) so
 * a cost estimate can be computed without inventing a different shape.
 * Not persisted to the database in this increment — reporting only.
 */
export interface ExtractionTokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  totalTokenCount?: number;
}

export interface ExtractionBatchResult {
  status: "extracted" | "partial" | "failed";
  fields: ExtractedField[];
  error?: string;
  providerMetadata?: {
    model: string;
    requestId?: string;
    latencyMs?: number;
    usage?: ExtractionTokenUsage;
  };
}

export interface ExtractionProvider {
  extractDocument(document: ExtractionDocumentInput, context: ExtractionContext): Promise<ExtractionBatchResult>;
}

export const EXTRACTION_PROVIDER = Symbol("EXTRACTION_PROVIDER");
