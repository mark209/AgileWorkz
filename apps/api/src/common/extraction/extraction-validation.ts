/**
 * Deterministic validation — Phase 5 Stage C correction plan, step 2
 * ("Deterministic validation"). Pure, rule-based checks over a SINGLE
 * extraction result, deciding whether it needs additional verification
 * calls. No AI call happens here; every rule is a plain heuristic.
 *
 * The actual rule primitives (critical-code list, format/range checks, the
 * abbreviation-taxonomy check) live in extraction-field-rules.ts and are
 * shared with extraction-risk-assessment.ts (Stage C.1), which applies the
 * SAME rules again to the final reconciled value — see that file's header
 * for why re-checking after consensus is necessary.
 */

import { ExtractedField, ExtractionContext } from "./extraction-provider.interface";
import {
  isCheckboxLikeValue,
  isCriticalField,
  isOutOfPlausibleRange,
  isSuspiciousFormat,
  isUnexplainedAbbreviationMapping,
} from "./extraction-field-rules";

export interface VerificationTrigger {
  reason: string;
  fieldName: string;
  category: string;
  groupKey?: string;
}

export interface ValidationResult {
  needsVerification: boolean;
  triggers: VerificationTrigger[];
}

/**
 * Report types whose forms structurally include checklist/checkbox
 * sections (per the reference table in the seed data — see
 * SERVICE_REPORT_TYPES in prisma/seed.ts — not any one vendor's layout).
 * Scoping the zero-checkbox trigger to these avoids the alternative: a
 * report type whose forms genuinely never carry checkboxes (an
 * Installation/Start-Up/Commissioning report is predominantly numeric
 * readings and signoffs) would otherwise escalate to 3 calls on every
 * single extraction, permanently defeating the adaptive/single-call fast
 * path for that entire document type rather than only for the genuinely
 * anomalous case the trigger is meant to catch.
 */
const REPORT_TYPES_WITH_EXPECTED_CHECKLISTS = new Set(["MAINTENANCE_CLEANING", "GENERAL_SERVICE_REPAIR"]);

export function evaluateExtraction(fields: ExtractedField[], context: ExtractionContext): ValidationResult {
  const triggers: VerificationTrigger[] = [];

  for (const field of fields) {
    if (isCriticalField(field)) {
      if (field.confidence === "low" || field.confidence === "unreadable") {
        triggers.push({ reason: "low-confidence-critical-field", fieldName: field.fieldName, category: field.category, groupKey: field.groupKey });
      }
      if (isSuspiciousFormat(field)) {
        triggers.push({ reason: "suspicious-value-format", fieldName: field.fieldName, category: field.category, groupKey: field.groupKey });
      }
      if (isOutOfPlausibleRange(field)) {
        triggers.push({ reason: "implausible-value-range", fieldName: field.fieldName, category: field.category, groupKey: field.groupKey });
      }
    }

    if (isUnexplainedAbbreviationMapping(field)) {
      triggers.push({ reason: "unexplained-abbreviation-taxonomy-mapping", fieldName: field.fieldName, category: field.category, groupKey: field.groupKey });
    }
  }

  // Coverage check, scoped by report type rather than any one document's
  // layout: if this report type's forms structurally include checklists
  // (per the ERP's own report-type reference table) and this extraction
  // found real content but zero checkbox-shaped values, that's worth a
  // second look. Report types that are predominantly numeric (e.g.
  // Installation/Start-Up/Commissioning) never fire this — for them, zero
  // checkboxes is the expected, normal case, not a coverage gap.
  const hasAnyRealContent = fields.some((f) => f.value !== null);
  const checkboxCount = fields.filter((f) => isCheckboxLikeValue(f.value)).length;
  if (REPORT_TYPES_WITH_EXPECTED_CHECKLISTS.has(context.reportTypeCode) && hasAnyRealContent && checkboxCount === 0) {
    triggers.push({ reason: "zero-checkboxes-found", fieldName: "(document-level)", category: "coverage" });
  }

  return { needsVerification: triggers.length > 0, triggers };
}
