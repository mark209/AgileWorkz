/**
 * Reconciliation — Phase 5 Stage C correction plan, step 3 ("selective
 * verification"). Matches fields across up to 3 extraction calls of the
 * SAME document and votes on a final value per field. No AI call happens
 * here; this is pure, deterministic post-processing.
 *
 * Field *labels* are not stable across separate calls (confirmed during
 * Stage B: the same field came back as "PRESSURE HIGH", "Pressure High",
 * and "High Pressure" across 3 runs of one document; confirmed again during
 * Stage C.1 on a free-text General Service Report layout: "Line 1", "L1",
 * "Operating Ampere Line 1" and "Operating Current L1" all described the
 * same physical current reading). Two matching strategies are combined:
 *
 *  1. Taxonomy-code identity (preferred): when a field carries a non-null
 *     suggestedMeasurementTypeCode, that code is trusted as the field's
 *     identity, regardless of how differently the raw fieldName is worded.
 *     This is safe against merging two DIFFERENT measurements, because the
 *     code is drawn from the same closed, approved vocabulary
 *     (ExtractionContext) on every call — two fields only share a code if
 *     the model itself already considers them the same taxonomy concept.
 *     "Suction (Indoor Unit Air Temp)" and "Suction (Outdoor Unit Air
 *     Temp)" both contain the word "Suction" but carry different codes
 *     (INDOOR_RETURN_AIR_TEMPERATURE vs OUTDOOR_SUCTION_AIR_TEMPERATURE)
 *     and are correctly kept apart.
 *  2. Word-normalized fieldName signature (fallback): used for
 *     non-measurement fields and any measurement field the model itself
 *     left uncoded (suggestedMeasurementTypeCode null, e.g. an
 *     unexplained-abbreviation case like "S"/"D") — never forced together
 *     by guessing a taxonomy the model didn't assert.
 *
 * Within either identity, a "stage" bucket (before/after/during, loosely
 * normalized) further disambiguates repeated readings of the same
 * code/name taken at different points in the service visit, and a
 * positional occurrence count disambiguates repeating rows/units (FCU 1..12,
 * Master/Slave1/Slave2) that share the same code+stage.
 */

import { ExtractedField, ExtractionConfidence } from "./extraction-provider.interface";
import { ReconciledField, ReconciliationStatus, downgradeConfidence } from "./adaptive-extraction.types";

function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    // Hyphens/ampersands between phase/line labels vary by call with no
    // real word-boundary meaning ("L1-L2" vs "L1L2" vs "L1 & L2" all came
    // back from the same physical field across separate calls on real
    // Stage C documents) — glue across them (remove, don't replace with a
    // space) before the space-producing punctuation strip below, so all
    // spellings collapse to the same token instead of splitting into a
    // different word count each time.
    .replace(/[-&]/g, "")
    .replace(/[().,°%]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function normalizeFieldNameSignature(name: string, stageBucket?: string): string {
  const normalized = normalizeWords(name);
  return normalized + (stageBucket ? `__${stageBucket}` : "");
}

/**
 * Collapses free-text stage wording into one of 3 broad, generic buckets
 * when the wording clearly says so ("BEFORE_OPERATION", "Prior to
 * Operation", and "Before Repair" are all plainly "before" something).
 * Anything that doesn't match a keyword keeps its own word-normalized
 * bucket rather than being guessed into "before"/"after"/"during" — an
 * ambiguous or genuinely distinct stage stays distinct.
 */
export function canonicalStageBucket(stage?: string): string | undefined {
  if (!stage) return undefined;
  // Underscores count as \w in JS regex, so "before_operation" would not
  // otherwise hit a \b boundary after "before" — normalize separators to
  // spaces first so the word-boundary keyword checks below see real word
  // breaks regardless of whether the source used "_", "-", or nothing.
  const s = stage.toLowerCase().replace(/[_-]/g, " ");
  if (/\b(before|prior|start|initial)\b/.test(s)) return "before";
  if (/\b(after|post|following|final)\b/.test(s)) return "after";
  if (/\b(during|operating|running|active)\b/.test(s)) return "during";
  return normalizeWords(s);
}

/**
 * A field's identity for cross-call matching purposes. Exported so
 * extraction-risk-assessment.ts can group reconciled fields the same way
 * (e.g. to pair a unit's high-side and low-side pressure readings) without
 * duplicating this logic.
 */
export function fieldIdentityKey(field: ExtractedField): string {
  const stageBucket = canonicalStageBucket(field.stage);
  // Checkbox-shaped fields are excluded from code-based identity even when
  // a code is present: a single loose code (e.g. INSTALLATION_CONDITION)
  // routinely covers a whole GROUP of distinct checklist items ("GOOD" /
  // "NO GOOD", "Check-up" / "Repair" / "Installation") that all need to
  // stay separate — for these, the label text is the only thing that
  // actually distinguishes one checkbox from another, so matching by code
  // alone silently cross-matches unrelated checkboxes that merely share a
  // taxonomy bucket (confirmed on a real VRV1 rerun: an unchecked "NO
  // GOOD" got voted against a checked, differently-labeled item). Numeric
  // measurement codes don't have this problem — CURRENT_L1 never covers
  // more than one physical reading per unit — so this exclusion is scoped
  // specifically to checkbox-valued fields.
  if (field.category === "measurement" && field.suggestedMeasurementTypeCode && !isCheckboxLikeValue(field.value)) {
    return `code:${field.suggestedMeasurementTypeCode}${stageBucket ? `__${stageBucket}` : ""}`;
  }
  return `name:${normalizeFieldNameSignature(field.fieldName)}${stageBucket ? `__${stageBucket}` : ""}`;
}

export function isCheckboxLikeValue(value: string | null): boolean {
  if (value === null) return false;
  return /^(checked|unchecked)$/i.test(value.trim());
}

/** Same unit-suffix stripping as extraction-field-rules.ts's format check — reused so voting isn't split by cosmetic value/unit representation differences (e.g. "40A" vs "40" + unit "A"). */
function stripUnitNoise(value: string): string {
  return value
    .trim()
    .replace(/°?[cCfF]$/, "")
    .replace(/\s*(psi|kg\/cm2|kg\/cm²|v|a|amps?|hrs?|min|mm2|mm²)\s*$/i, "")
    .trim();
}

function canonicalValueKey(field: ExtractedField): string {
  if (field.value === null) return " NULL";
  return stripUnitNoise(field.value).toLowerCase();
}

/**
 * Assigns each field a (identity, occurrence) position key within its own
 * call's field list — same positional-matching technique used since Stage
 * B/C, now keyed by fieldIdentityKey() instead of raw fieldName text.
 */
function assignPositionalKeys(fields: ExtractedField[]): Map<ExtractedField, { key: string; occurrenceIndex: number }> {
  const seenCount = new Map<string, number>();
  const keys = new Map<ExtractedField, { key: string; occurrenceIndex: number }>();
  for (const f of fields) {
    const base = `${f.category}::${fieldIdentityKey(f)}`;
    const occurrenceIndex = (seenCount.get(base) ?? 0) + 1;
    seenCount.set(base, occurrenceIndex);
    keys.set(f, { key: `${base}::#${occurrenceIndex}`, occurrenceIndex });
  }
  return keys;
}

/** No extra calls were needed — passes the single call's fields through unchanged, just tagged. */
export function reconcileSingleCall(fields: ExtractedField[]): ReconciledField[] {
  const positions = assignPositionalKeys(fields);
  return fields.map((f) => ({
    ...f,
    reconciliationStatus: "single-call" as ReconciliationStatus,
    requiresHumanVerification: false,
    contributingObservations: [f],
    groupOccurrenceIndex: positions.get(f)!.occurrenceIndex,
  }));
}

/**
 * Reconciles exactly 3 calls of the same document. Voting rule per field:
 *  - all 3 agree (after unit-noise-stripped, case-folded comparison) -> unanimous, confidence unchanged.
 *  - 2 of 3 agree -> majority, confidence downgraded one step (never invents a value merely to reach consensus — the majority's OWN reported value is used, nothing synthesized).
 *  - no majority among non-checkbox fields -> unresolved: value forced to null, confidence "unreadable", flagged for human verification. Conservative by design (Stage C step 3: "never invent a value merely to obtain consensus"; step on blank/unreadable fields: null takes precedence when evidence is insufficient).
 *  - no majority among checkbox-shaped fields -> coverage recovery: included anyway (from whichever call found it) at low confidence, rather than dropped, since a missing checkbox is a coverage gap (Correction 4), not a fabricated-value risk (Correction 1) — the two failure modes get different, deliberately asymmetric treatment.
 *
 * Reaching "unanimous" or "majority" here means the 3 raw calls agree —
 * it does NOT by itself mean the agreed value is correct. Multiple
 * independent calls can share the same misreading (Stage C.1 finding).
 * That risk is NOT handled in this file — see extraction-risk-assessment.ts,
 * which re-checks the winning value (and, for critical fields, requires
 * more than "majority" alone) after this function returns.
 */
export function reconcile(perCallFields: ExtractedField[][]): ReconciledField[] {
  const totalCalls = perCallFields.length;
  const positionalMaps = perCallFields.map((fields) => {
    const positions = assignPositionalKeys(fields);
    const byKey = new Map<string, { field: ExtractedField; occurrenceIndex: number }>();
    for (const [field, pos] of positions) byKey.set(pos.key, { field, occurrenceIndex: pos.occurrenceIndex });
    return byKey;
  });

  const allKeys = new Set<string>();
  for (const m of positionalMaps) for (const k of m.keys()) allKeys.add(k);

  const results: ReconciledField[] = [];

  for (const key of allKeys) {
    const entries = positionalMaps.map((m) => m.get(key)).filter((e): e is { field: ExtractedField; occurrenceIndex: number } => e !== undefined);
    if (entries.length === 0) continue;
    const observations = entries.map((e) => e.field);
    const groupOccurrenceIndex = entries[0].occurrenceIndex;

    const isCheckbox = observations.some((f) => isCheckboxLikeValue(f.value));

    const voteCounts = new Map<string, { count: number; field: ExtractedField }>();
    for (const f of observations) {
      const vk = canonicalValueKey(f);
      const existing = voteCounts.get(vk);
      voteCounts.set(vk, { count: (existing?.count ?? 0) + 1, field: existing?.field ?? f });
    }
    const ranked = [...voteCounts.values()].sort((a, b) => b.count - a.count);
    const top = ranked[0];

    let status: ReconciliationStatus;
    let requiresHumanVerification = false;
    let value = top.field.value;
    let confidence: ExtractionConfidence = top.field.confidence;

    if (top.count === totalCalls) {
      status = "unanimous";
    } else if (top.count >= 2) {
      status = "majority";
      confidence = downgradeConfidence(top.field.confidence);
    } else if (isCheckbox) {
      // Coverage recovery (Correction 4) — include the best available
      // observation rather than dropping it, at reduced confidence.
      status = "majority";
      confidence = "low";
    } else {
      // No majority on a non-checkbox field — conservative fallback
      // (Correction 1 / Stage C step 3): never invent a value to reach
      // consensus, prefer null when evidence is insufficient.
      status = "unresolved";
      requiresHumanVerification = true;
      value = null;
      confidence = "unreadable";
    }

    results.push({
      ...top.field,
      value,
      confidence,
      reconciliationStatus: status,
      requiresHumanVerification,
      contributingObservations: observations,
      groupOccurrenceIndex,
    });
  }

  return results;
}
