import { ExtractedField, ExtractionConfidence, ExtractionTokenUsage } from "./extraction-provider.interface";
import { VerificationTrigger } from "./extraction-validation";

export type ReconciliationStatus = "single-call" | "unanimous" | "majority" | "unresolved";

/**
 * A field after the adaptive pipeline has run. A strict superset of
 * ExtractedField — existing consumers (field-routing.ts, the staging
 * writer) that only know about ExtractedField's shape keep working
 * unchanged, since routeFieldsByCategory()/assignRowIndexes() only read the
 * ExtractedField-shaped subset of these properties.
 */
export interface ReconciledField extends ExtractedField {
  reconciliationStatus: ReconciliationStatus;
  /**
   * Phase 5 Stage C, step 8 ("human verification"): true for any field that
   * remained genuinely unresolved after the maximum verification attempts,
   * OR (Stage C.1) that a post-reconciliation deterministic risk check
   * flagged despite reaching consensus — see extraction-risk-assessment.ts.
   * Not a new persisted column — the queue processor folds this into the
   * existing ai_confidence value ("unreadable") before writing to staging,
   * and the full detail (which fields, why) goes to the audit log's
   * afterData instead. See service-report-extraction.processor.ts.
   */
  requiresHumanVerification: boolean;
  /**
   * Stage C.1: the raw per-call observations that were matched together to
   * produce this reconciled field (1-3 entries — fewer than the total call
   * count when a call didn't report this field at all). Kept so
   * extraction-risk-assessment.ts can look at each contributing call's own
   * reported confidence, not just the winning vote's — a field that
   * "won" a majority vote while one of its own contributing observations
   * was itself low-confidence is a different risk profile than one where
   * every contributor was confident.
   */
  contributingObservations: ExtractedField[];
  /**
   * Stage C.1: 1-based occurrence index of this field within its own
   * identity bucket (same taxonomy code, or same normalized name when no
   * code applies) — i.e. "this is the Nth time this specific reading
   * appears in the document". Two different-coded critical fields sharing
   * the same groupOccurrenceIndex (e.g. the 2nd HIGH_SIDE_PRESSURE and the
   * 2nd LOW_SIDE_PRESSURE) are very likely readings from the same physical
   * unit/row, since a model reads a document's repeating rows in the same
   * top-to-bottom order for every column — this is what lets
   * extraction-risk-assessment.ts cross-check physically-related readings
   * (e.g. high-side pressure must exceed low-side pressure) without relying
   * on groupKey text, which is not stable across calls.
   */
  groupOccurrenceIndex: number;
}

export interface PerCallMetadata {
  model: string;
  latencyMs?: number;
  usage?: ExtractionTokenUsage;
}

/**
 * The adaptive pipeline's result — what AdaptiveExtractionService returns
 * to the queue processor. Deliberately its own type, not a change to
 * ExtractionBatchResult/ExtractionProvider — those stay exactly as
 * approved; this wraps them.
 */
export interface AdaptiveExtractionResult {
  status: "extracted" | "partial" | "failed";
  fields: ReconciledField[];
  error?: string;
  callsUsed: 1 | 2 | 3;
  verificationTriggers: VerificationTrigger[];
  perCallMetadata: PerCallMetadata[];
  totalLatencyMs: number;
  /** Sum of every call's usage, when the provider reports it. */
  totalUsage: ExtractionTokenUsage;
}

export function downgradeConfidence(original: ExtractionConfidence): ExtractionConfidence {
  if (original === "high") return "medium";
  if (original === "medium") return "low";
  return original;
}

// Approximate — the same rates used in the Stage B cost analysis
// ($0.30/1M input tokens, $2.50/1M output tokens for gemini-2.5-flash).
// Not independently re-verified against a live Cloud Billing console; see
// Phase 5 Approved Baseline §04a's pricing caveat. Reconfirm before relying
// on this for real budgeting.
const INPUT_RATE_PER_MILLION_USD = 0.3;
const OUTPUT_RATE_PER_MILLION_USD = 2.5;

export function estimateCostUsd(usage: ExtractionTokenUsage): number {
  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (inputTokens / 1_000_000) * INPUT_RATE_PER_MILLION_USD + (outputTokens / 1_000_000) * OUTPUT_RATE_PER_MILLION_USD;
}
