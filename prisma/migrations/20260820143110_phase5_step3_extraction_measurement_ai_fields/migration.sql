-- Phase 5 Step 3 (queue processor increment) — adds the two columns to
-- extraction_measurements flagged as a known future need in the Step 3
-- provider-implementation-design increment, and now explicitly approved:
--
-- - ai_unit: the raw extracted unit, preserved separately from ai_value.
--   Never converted or normalized — same "never parse/convert a unit" rule
--   already applied to the canonical side.
-- - suggested_measurement_type_code: the provider's non-binding suggested
--   mapping to one of the 33 approved measurement_types. A real FK (RESTRICT
--   on delete, CASCADE on update) so an invented/out-of-list code is
--   impossible at the database level — mirrors the existing
--   service_report_problems.problem_type_code pattern. Nullable: an
--   unresolved suggestion stays NULL, never coerced to a nearest-match
--   guess. Staging data only — this can never become canonical on its own,
--   only a human verifier (Step 5+) reads it as a hint.
--
-- extraction_measurements already carries the ocr_worker table-level grant
-- from Step 1 (infra/sql/grant-runtime-privileges.sql) — new columns on an
-- already-granted table need no additional grant statement.
--
-- Confirmed empty (zero rows) before this migration — no extraction writes
-- exist yet, since the queue processor that would produce them is this same
-- increment.

-- AlterTable
ALTER TABLE "extraction_measurements" ADD COLUMN     "ai_unit" VARCHAR(60),
ADD COLUMN     "suggested_measurement_type_code" VARCHAR(40);

-- CreateIndex
CREATE INDEX "extraction_measurements_suggested_measurement_type_code_idx" ON "extraction_measurements"("suggested_measurement_type_code");

-- AddForeignKey
ALTER TABLE "extraction_measurements" ADD CONSTRAINT "extraction_measurements_suggested_measurement_type_code_fkey" FOREIGN KEY ("suggested_measurement_type_code") REFERENCES "measurement_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
