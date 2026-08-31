/**
 * Phase 5 Step 5 — the six extraction_* staging tables, addressed by the
 * same category name the extraction pipeline already uses
 * (ExtractionFieldCategory in extraction-provider.interface.ts), not by
 * their SQL table names, so the verification API's shape matches how the
 * rest of the extraction code already thinks about these six buckets.
 */
export const STAGING_CATEGORIES = [
  "basicInfo",
  "equipmentUnit",
  "problem",
  "measurement",
  "narrativeItem",
  "signoff",
] as const;

export type StagingCategory = (typeof STAGING_CATEGORIES)[number];

export function isStagingCategory(value: string): value is StagingCategory {
  return (STAGING_CATEGORIES as readonly string[]).includes(value);
}
