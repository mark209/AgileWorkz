-- Phase 5 Step 5 (Human Verification Workflow) — additive only.
--
-- Adds two columns to each of the six extraction_* staging tables:
--   requires_human_verification — AI-computed (written by the extraction
--     pipeline alongside ai_value/ai_confidence, never touched by
--     verification), carrying forward the adaptive pipeline's
--     ReconciledField.requiresHumanVerification flag so the verification UI
--     can prioritize exactly the fields Stage C.1's post-consensus risk
--     assessment flagged, which previously only reached audit_logs.
--   review_status — human-set only, distinguishes "not yet reviewed" (NULL)
--     from an explicit CONFIRMED / CORRECTED / CONFIRMED_BLANK /
--     NEEDS_FOLLOW_UP decision, so a confirmed-blank field is never
--     indistinguishable from an unreviewed one.
--
-- No existing column, table, constraint, or grant is touched. ocr_worker's
-- and app_runtime's existing table-level grants (infra/sql/
-- grant-runtime-privileges.sql) already cover new columns on these same
-- six tables — no grant changes needed.

-- CreateEnum
CREATE TYPE "ExtractionReviewStatus" AS ENUM ('CONFIRMED', 'CORRECTED', 'CONFIRMED_BLANK', 'NEEDS_FOLLOW_UP');

-- AlterTable
ALTER TABLE "extraction_basic_info"
  ADD COLUMN "requires_human_verification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "review_status" "ExtractionReviewStatus";

-- AlterTable
ALTER TABLE "extraction_equipment_units"
  ADD COLUMN "requires_human_verification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "review_status" "ExtractionReviewStatus";

-- AlterTable
ALTER TABLE "extraction_problems"
  ADD COLUMN "requires_human_verification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "review_status" "ExtractionReviewStatus";

-- AlterTable
ALTER TABLE "extraction_measurements"
  ADD COLUMN "requires_human_verification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "review_status" "ExtractionReviewStatus";

-- AlterTable
ALTER TABLE "extraction_narrative_items"
  ADD COLUMN "requires_human_verification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "review_status" "ExtractionReviewStatus";

-- AlterTable
ALTER TABLE "extraction_signoffs"
  ADD COLUMN "requires_human_verification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "review_status" "ExtractionReviewStatus";
