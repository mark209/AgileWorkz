/**
 * Shared deterministic rule primitives for critical HVAC numerical fields —
 * Phase 5 Stage C / Stage C.1. Pulled out of extraction-validation.ts so the
 * SAME rules can be applied at two different points in the pipeline without
 * duplicating (and risking drifting) the logic:
 *
 *  - extraction-validation.ts applies these to the FIRST raw call's fields,
 *    to decide whether additional verification calls are worth making at
 *    all (Stage C, step 2).
 *  - extraction-risk-assessment.ts (Stage C.1) applies the SAME rules again
 *    to the FINAL reconciled/voted value, because a value that fails a
 *    format/range check can still win a majority or even unanimous vote if
 *    multiple independent calls share the same misreading — consensus
 *    alone does not prove correctness for a critical field.
 *
 * No AI call happens anywhere in this file; every rule is a plain,
 * deterministic heuristic. The specific tables below are a reasonable first
 * pass grounded in the real forms and corruption patterns observed during
 * Stage A/B/C ("17C"/"170" for a thermostat setting, "ISA" for a breaker
 * capacity, "6-4" for a temperature) — expected to need tuning as more
 * real-world extractions accumulate, which is exactly what the Stage C
 * observability additions (verificationTriggers in the audit log) exist to
 * support.
 */

import { ExtractedField } from "./extraction-provider.interface";

/**
 * The "critical HVAC numerical readings" the approved Stage C plan calls
 * out for stricter validation: voltage, current, pressure, temperature,
 * pipe measurements, thermostat settings, plus breaker capacity (Stage B's
 * own systematic-failure evidence was on exactly these two field types).
 */
export const CRITICAL_MEASUREMENT_TYPE_CODES = new Set([
  "VOLTAGE",
  "VOLTAGE_L1_L2",
  "VOLTAGE_L1_L3",
  "VOLTAGE_L2_L3",
  "CURRENT",
  "CURRENT_L1",
  "CURRENT_L2",
  "CURRENT_L3",
  "HIGH_SIDE_PRESSURE",
  "LOW_SIDE_PRESSURE",
  "SUCTION_PIPE_TEMPERATURE",
  "DISCHARGE_PIPE_TEMPERATURE",
  "LIQUID_PIPE_TEMPERATURE",
  "INDOOR_RETURN_AIR_TEMPERATURE",
  "INDOOR_SUPPLY_AIR_TEMPERATURE",
  "OUTDOOR_SUCTION_AIR_TEMPERATURE",
  "OUTDOOR_DISCHARGE_AIR_TEMPERATURE",
  "ROOM_TEMPERATURE",
  "AMBIENT_TEMPERATURE",
  "PIPE_SIZE_LIQUID",
  "PIPE_SIZE_GAS",
  "BREAKER_CAPACITY",
  "THERMOSTAT_SETTING",
]);

export function isCriticalField(field: ExtractedField): boolean {
  return field.category === "measurement" && !!field.suggestedMeasurementTypeCode && CRITICAL_MEASUREMENT_TYPE_CODES.has(field.suggestedMeasurementTypeCode);
}

/**
 * Expected value shape per critical type — a permissive regex plus a set of
 * legitimate non-numeric literal answers real forms actually use (e.g.
 * "NA"/"N/A" for a not-applicable breaker capacity, "Auto Charge" for
 * refrigerant charge elsewhere). A value failing BOTH the pattern and the
 * literal allowlist is "suspicious format", not automatically wrong — it
 * only triggers a verification pass or a human-verification flag, never an
 * automatic rejection or replacement.
 */
const NUMERIC_PATTERN = /^-?\d{1,4}(\.\d{1,2})?$/;
export const ALLOWED_NON_NUMERIC_LITERALS = new Set(["na", "n/a", "auto charge", "-", "none"]);

// Pipe sizes are conventionally reported as a fraction of an inch ("3/8",
// "5/8") or a whole-plus-fraction mixed number ("1 3/8"), never as a
// decimal — real forms genuinely use this shape, it is not corruption.
// Scoped to the two pipe-size codes specifically: the same shape on a
// voltage/temperature/pressure reading would still be suspicious.
const FRACTION_PATTERN = /^\d{1,2}\/\d{1,2}$/;
const MIXED_NUMBER_PATTERN = /^\d{1,2}\s\d{1,2}\/\d{1,2}$/;
const PIPE_SIZE_CODES = new Set(["PIPE_SIZE_LIQUID", "PIPE_SIZE_GAS"]);

export function stripUnitNoise(value: string): string {
  // Strip common unit suffixes/prefixes so "410 PSI", "40A", "17°C" etc. can
  // be checked against NUMERIC_PATTERN without needing one regex per unit.
  return value
    .trim()
    .replace(/°?[cCfF]$/, "")
    .replace(/\s*(psi|kg\/cm2|kg\/cm²|v|a|amps?|hrs?|min|mm2|mm²)\s*$/i, "")
    .trim();
}

export function isSuspiciousFormat(field: ExtractedField): boolean {
  if (field.value === null) return false; // null is handled by the confidence check, not format
  const raw = field.value.trim();
  if (ALLOWED_NON_NUMERIC_LITERALS.has(raw.toLowerCase())) return false;
  const stripped = stripUnitNoise(raw);
  if (NUMERIC_PATTERN.test(stripped)) return false;
  if (
    field.suggestedMeasurementTypeCode &&
    PIPE_SIZE_CODES.has(field.suggestedMeasurementTypeCode) &&
    (FRACTION_PATTERN.test(stripped) || MIXED_NUMBER_PATTERN.test(stripped))
  ) {
    return false;
  }
  return true;
}

/**
 * A generous plausible-range table — deliberately wide, since the goal is
 * to catch obviously-implausible values (a wildly out-of-range digit swap
 * or a dropped decimal point, e.g. "170" for a 0-40 thermostat setting),
 * not to second-guess genuinely unusual-but-real readings. Only applied
 * when the value passed the format check above (already-suspicious-format
 * values are flagged either way).
 */
export const PLAUSIBLE_RANGES: Record<string, [number, number]> = {
  VOLTAGE: [50, 600],
  VOLTAGE_L1_L2: [50, 600],
  VOLTAGE_L1_L3: [50, 600],
  VOLTAGE_L2_L3: [50, 600],
  CURRENT: [0, 300],
  CURRENT_L1: [0, 300],
  CURRENT_L2: [0, 300],
  CURRENT_L3: [0, 300],
  HIGH_SIDE_PRESSURE: [0, 1000],
  LOW_SIDE_PRESSURE: [0, 500],
  SUCTION_PIPE_TEMPERATURE: [-50, 150],
  DISCHARGE_PIPE_TEMPERATURE: [-50, 150],
  LIQUID_PIPE_TEMPERATURE: [-50, 150],
  INDOOR_RETURN_AIR_TEMPERATURE: [-20, 60],
  INDOOR_SUPPLY_AIR_TEMPERATURE: [-20, 60],
  OUTDOOR_SUCTION_AIR_TEMPERATURE: [-20, 80],
  OUTDOOR_DISCHARGE_AIR_TEMPERATURE: [-20, 80],
  ROOM_TEMPERATURE: [-20, 60],
  AMBIENT_TEMPERATURE: [-20, 60],
  BREAKER_CAPACITY: [0, 300],
  THERMOSTAT_SETTING: [0, 40],
};

export function isOutOfPlausibleRange(field: ExtractedField): boolean {
  if (field.value === null) return false;
  const raw = field.value.trim();
  if (ALLOWED_NON_NUMERIC_LITERALS.has(raw.toLowerCase())) return false;
  const code = field.suggestedMeasurementTypeCode;
  if (!code || !(code in PLAUSIBLE_RANGES)) return false;
  const stripped = stripUnitNoise(raw);
  const n = Number(stripped);
  if (Number.isNaN(n)) return false; // already caught by isSuspiciousFormat
  const [min, max] = PLAUSIBLE_RANGES[code];
  return n < min || n > max;
}

/**
 * Correction 2's detection counterpart — generalizes past the specific S/D
 * case: a bare 1-2 letter/abbreviation fieldName (no clarifying word like
 * "liquid"/"gas"/"suction"/"discharge" spelled out) that nonetheless got a
 * confident non-null taxonomy suggestion is exactly the pattern the prompt
 * fix targets. This check is a safety net independent of the prompt —
 * catches it even if the prompt-level fix is ever weakened by a future
 * change, or doesn't fully eliminate the behavior on its own.
 */
const CLARIFYING_WORDS = /(liquid|gas|suction|discharge|return|supply)/i;

export function isUnexplainedAbbreviationMapping(field: ExtractedField): boolean {
  if (!field.suggestedMeasurementTypeCode) return false;
  const bareLabel = field.fieldName.replace(/[^a-z]/gi, "");
  const looksLikeBareAbbreviation = bareLabel.length > 0 && bareLabel.length <= 2;
  return looksLikeBareAbbreviation && !CLARIFYING_WORDS.test(field.fieldName);
}

export function isCheckboxLikeValue(value: string | null): boolean {
  if (value === null) return false;
  return /^(checked|unchecked)$/i.test(value.trim());
}

/**
 * Parses a critical field's value to its bare numeric magnitude for
 * cross-field comparison (e.g. is high-side pressure actually higher than
 * low-side pressure?). Returns null for anything that isn't a clean numeric
 * reading — cross-field checks skip a field entirely rather than guess at
 * a fraction/literal's magnitude.
 */
export function numericMagnitude(field: ExtractedField): number | null {
  if (field.value === null) return null;
  const raw = field.value.trim();
  if (ALLOWED_NON_NUMERIC_LITERALS.has(raw.toLowerCase())) return null;
  const stripped = stripUnitNoise(raw);
  const n = Number(stripped);
  return Number.isNaN(n) ? null : n;
}
