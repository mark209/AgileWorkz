/**
 * Post-reconciliation risk assessment — Phase 5 Stage C.1. Runs AFTER
 * extraction-consensus.ts has already voted on a final value per field.
 * Its entire purpose is the gap Stage C's acceptance test exposed:
 * "unanimous" or "majority" consensus among 2-3 Gemini calls proves the
 * calls AGREE with each other, not that they are correct — multiple
 * independent calls can share the exact same misreading of a handwritten
 * or degraded value. No amount of extra Gemini calls fixes a shared,
 * systematic misread (more votes for the same wrong answer is not more
 * evidence it's right), so every check in this file is a deterministic,
 * non-AI rule — the same spirit as extraction-validation.ts, but applied
 * to the WINNING reconciled value instead of a single raw call, and able
 * to override even a unanimous result.
 *
 * Every rule here can only ADD a requiresHumanVerification flag and a
 * VerificationTrigger record for observability. None of them ever change
 * `value` or `confidence`, and none of them ever clear a flag another rule
 * (or extraction-consensus.ts) already set — a suspicious critical
 * reading is always preserved verbatim and traceable to what the model
 * actually reported, never silently replaced with a "more plausible"
 * guess.
 */

import { VerificationTrigger } from "./extraction-validation";
import { ReconciledField } from "./adaptive-extraction.types";
import { canonicalStageBucket } from "./extraction-consensus";
import { isCriticalField, isOutOfPlausibleRange, isSuspiciousFormat, numericMagnitude } from "./extraction-field-rules";

export interface RiskAssessmentResult {
  fields: ReconciledField[];
  triggers: VerificationTrigger[];
}

/**
 * Three-phase supply voltages are expected to be roughly balanced in a
 * healthy installation. A generous tolerance (20%) keeps this a "worth a
 * look" signal rather than a false-positive-prone strict check — real
 * imbalance faults exist, so this flags for a human to judge, it never
 * concludes which reading (if any) is wrong.
 */
const VOLTAGE_PHASE_CODES = ["VOLTAGE_L1_L2", "VOLTAGE_L1_L3", "VOLTAGE_L2_L3"];
const VOLTAGE_IMBALANCE_TOLERANCE = 0.2;

function bucketKey(field: ReconciledField): string {
  return `${canonicalStageBucket(field.stage) ?? ""}::${field.groupOccurrenceIndex}`;
}

/**
 * Groups fields sharing a code from `codes` by (stage bucket, occurrence
 * index) — a generic stand-in for "belongs to the same physical
 * unit/row", since groupKey text is not stable across calls but the
 * relative reading order of a repeating row generally is (see
 * extraction-consensus.ts's header for the same assumption already relied
 * on for voting).
 */
function groupByOccurrence(fields: ReconciledField[], codes: string[]): Map<string, ReconciledField[]> {
  const buckets = new Map<string, ReconciledField[]>();
  for (const f of fields) {
    if (f.category !== "measurement" || !f.suggestedMeasurementTypeCode || !codes.includes(f.suggestedMeasurementTypeCode)) continue;
    const key = bucketKey(f);
    const existing = buckets.get(key);
    if (existing) existing.push(f);
    else buckets.set(key, [f]);
  }
  return buckets;
}

function flag(field: ReconciledField, triggers: VerificationTrigger[], reason: string): void {
  field.requiresHumanVerification = true;
  triggers.push({ reason, fieldName: field.fieldName, category: field.category, groupKey: field.groupKey });
}

/**
 * Rule 1 — re-apply the same format/range rules used to decide whether to
 * escalate (extraction-validation.ts) to the FINAL reconciled value. A
 * value that fails these checks does not stop being suspicious just
 * because 2 or 3 independent calls happened to agree on it.
 */
function checkFormatAndRange(field: ReconciledField, triggers: VerificationTrigger[]): void {
  if (!isCriticalField(field)) return;
  if (isSuspiciousFormat(field)) flag(field, triggers, "post-consensus-suspicious-format");
  if (isOutOfPlausibleRange(field)) flag(field, triggers, "post-consensus-implausible-range");
}

/**
 * Rule 2 — for critical fields, only "unanimous" is treated as strong
 * enough evidence to skip a mandatory flag. "Majority" (2 of 3) means real
 * disagreement occurred on a high-stakes reading; that disagreement is
 * already reflected in a downgraded confidence, but for critical fields
 * specifically it also always requires a human look, on top of whatever
 * value ultimately won the vote.
 */
function checkMajorityInsufficientForCritical(field: ReconciledField, triggers: VerificationTrigger[]): void {
  if (!isCriticalField(field)) return;
  if (field.reconciliationStatus === "majority") {
    flag(field, triggers, "majority-consensus-insufficient-for-critical-field");
  }
}

/**
 * Rule 3 — a field can reach "unanimous"/"majority" on its final value
 * while one of the raw calls that contributed to it was itself uncertain.
 * The reconciled output only carries a single representative confidence
 * (whichever observation happened to be recorded first for the winning
 * vote), so this looks at every contributing raw observation, not just
 * the one attached to the result.
 */
function checkLowConfidenceAmongContributors(field: ReconciledField, triggers: VerificationTrigger[]): void {
  if (!isCriticalField(field)) return;
  const anyLow = field.contributingObservations.some((o) => o.confidence === "low" || o.confidence === "unreadable");
  if (anyLow) flag(field, triggers, "low-confidence-among-contributing-calls");
}

/**
 * Rule 4 — contradictory related readings, generic HVAC/electrical facts
 * rather than anything document-specific:
 *  (a) high-side pressure must exceed low-side pressure in any
 *      refrigeration cycle — a reversal is never a real reading.
 *  (b) three-phase supply voltages (L1-L2, L1-L3, L2-L3) are expected to
 *      be roughly balanced — a large outlier is worth a look, though real
 *      faults exist so this stays a soft, generous-tolerance signal.
 */
function checkContradictoryReadings(fields: ReconciledField[], triggers: VerificationTrigger[]): void {
  const pressureHigh = groupByOccurrence(fields, ["HIGH_SIDE_PRESSURE"]);
  const pressureLow = groupByOccurrence(fields, ["LOW_SIDE_PRESSURE"]);
  for (const [key, highFields] of pressureHigh) {
    const lowFields = pressureLow.get(key);
    if (!lowFields) continue;
    for (const high of highFields) {
      for (const low of lowFields) {
        const highValue = numericMagnitude(high);
        const lowValue = numericMagnitude(low);
        if (highValue === null || lowValue === null) continue;
        if (highValue <= lowValue) {
          flag(high, triggers, "contradictory-pressure-reading");
          flag(low, triggers, "contradictory-pressure-reading");
        }
      }
    }
  }

  const voltageBuckets = groupByOccurrence(fields, VOLTAGE_PHASE_CODES);
  for (const group of voltageBuckets.values()) {
    const withMagnitude = group.map((f) => ({ field: f, magnitude: numericMagnitude(f) })).filter((g): g is { field: ReconciledField; magnitude: number } => g.magnitude !== null);
    if (withMagnitude.length < 2) continue;
    const magnitudes = withMagnitude.map((g) => g.magnitude);
    const max = Math.max(...magnitudes);
    const min = Math.min(...magnitudes);
    const mean = (max + min) / 2;
    if (mean > 0 && (max - min) / mean > VOLTAGE_IMBALANCE_TOLERANCE) {
      for (const { field } of withMagnitude) flag(field, triggers, "voltage-phase-imbalance");
    }
  }
}

/**
 * Runs every deterministic risk rule over a fully-reconciled field list.
 * Pure and side-effect-free on its input — returns new field objects, the
 * caller's array/objects are never mutated in place from outside this
 * module's perspective (rules above do mutate the shallow-cloned copies
 * created here, not the originals).
 */
export function assessRisk(fields: ReconciledField[]): RiskAssessmentResult {
  const cloned: ReconciledField[] = fields.map((f) => ({ ...f }));
  const triggers: VerificationTrigger[] = [];

  for (const field of cloned) {
    checkFormatAndRange(field, triggers);
    checkMajorityInsufficientForCritical(field, triggers);
    checkLowConfidenceAmongContributors(field, triggers);
  }
  checkContradictoryReadings(cloned, triggers);

  return { fields: cloned, triggers };
}
